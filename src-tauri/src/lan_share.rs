use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{
    db,
    error::{LibrError, LibrResult},
    models::{Asset, AssetPatch, DiscoveredLanShare, LanShareInfo, SearchQuery},
    protocol,
    state::{AppState, LanShareRuntime},
};

const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MAX_RANGE_BYTES: usize = 4 * 1024 * 1024;
const DISCOVERY_PORT: u16 = 42137;
const DISCOVERY_MAGIC: &[u8] = b"LIBR_SHARE_V1\n";
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(2);
const DISCOVERY_EXPIRY: Duration = Duration::from_secs(7);
const MAX_DISCOVERY_PACKET_BYTES: usize = 2 * 1024;

#[derive(Clone, Debug)]
struct Ipv4Interface {
    name: String,
    address: Ipv4Addr,
    netmask: Ipv4Addr,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LanShareAnnouncement {
    instance_id: String,
    device_name: String,
    folder_name: String,
    permission: String,
    port: u16,
    token: String,
}

#[derive(Clone)]
struct ShareConfig {
    folder_id: String,
    folder_name: String,
    token: String,
    allow_editing: bool,
    stop: Arc<AtomicBool>,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedAsset {
    id: String,
    display_name: String,
    kind: String,
    mime: String,
    byte_size: i64,
    width: Option<i64>,
    height: Option<i64>,
    rating: i64,
    favorite: bool,
    notes: String,
    imported_at: String,
    has_preview: bool,
}

impl From<Asset> for SharedAsset {
    fn from(asset: Asset) -> Self {
        Self {
            id: asset.id,
            display_name: asset.display_name,
            kind: asset.kind.as_str().to_owned(),
            mime: asset.mime,
            byte_size: asset.byte_size,
            width: asset.width,
            height: asset.height,
            rating: asset.rating,
            favorite: asset.favorite,
            notes: asset.notes,
            imported_at: asset.imported_at,
            has_preview: asset.preview_url.is_some(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedAssetMutation {
    display_name: Option<String>,
    favorite: Option<bool>,
    rating: Option<i64>,
    notes: Option<String>,
    trash: Option<bool>,
}

pub fn start(
    app: AppHandle,
    state: AppState,
    folder_id: String,
    allow_editing: bool,
) -> LibrResult<LanShareInfo> {
    state.stop_lan_share();
    let (folder_name, read_only) = {
        let guard = state.session.lock();
        let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
        let protected = db::folder_lock_owners(session, &HashSet::new())?;
        if protected.contains_key(&folder_id) {
            return Err(LibrError::Other(
                "密码保护的文件夹不能通过局域网共享".into(),
            ));
        }
        let folder = db::list_folders(session)?
            .into_iter()
            .find(|folder| folder.id == folder_id)
            .ok_or_else(|| LibrError::Other("要共享的文件夹不存在".into()))?;
        (folder.name, session.read_only)
    };
    if allow_editing && read_only {
        return Err(LibrError::ReadOnly);
    }

    let listener = TcpListener::bind(("0.0.0.0", 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let token = uuid::Uuid::new_v4().simple().to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let config = ShareConfig {
        folder_id: folder_id.clone(),
        folder_name: folder_name.clone(),
        token: token.clone(),
        allow_editing,
        stop: stop.clone(),
    };
    let url = format!("http://{}:{port}/share/{token}", local_ipv4());
    let info = LanShareInfo {
        active: true,
        folder_id: Some(folder_id),
        folder_name: Some(folder_name.clone()),
        permission: Some(if allow_editing { "manage" } else { "readOnly" }.into()),
        url: Some(url),
        port: Some(port),
    };
    let thread_state = state.clone();
    thread::Builder::new()
        .name("libr-lan-share".into())
        .spawn(move || serve(listener, app, thread_state, config))
        .map_err(|error| {
            stop.store(true, Ordering::Release);
            LibrError::Other(format!("无法启动局域网共享：{error}"))
        })?;
    let announcement = LanShareAnnouncement {
        instance_id: state.lan_share_instance_id.clone(),
        device_name: device_name(),
        folder_name: folder_name.clone(),
        permission: if allow_editing { "manage" } else { "readOnly" }.into(),
        port,
        token,
    };
    let advertiser_stop = stop.clone();
    let _ = thread::Builder::new()
        .name("libr-lan-advertiser".into())
        .spawn(move || advertise_share(advertiser_stop, announcement));
    *state.lan_share.lock() = Some(LanShareRuntime {
        stop: stop.clone(),
        info: info.clone(),
    });
    Ok(info)
}

fn local_ipv4() -> String {
    interface_ipv4_candidates()
        .into_iter()
        .max_by_key(|interface| local_ipv4_score(&interface.name, interface.address))
        .map(|interface| interface.address)
        .or_else(routed_local_ipv4)
        .map(|address| address.to_string())
        .unwrap_or_else(|| "127.0.0.1".into())
}

fn local_ipv4_score(interface_name: &str, address: Ipv4Addr) -> i32 {
    let address_score = if address.is_private() {
        300
    } else if is_shared_address(address) {
        200
    } else if address.is_link_local() {
        100
    } else {
        0
    };
    let interface_score = if is_likely_physical_interface(interface_name) {
        20
    } else if is_likely_virtual_interface(interface_name) {
        -20
    } else {
        0
    };
    address_score + interface_score
}

fn is_likely_physical_interface(name: &str) -> bool {
    name.starts_with("en")
        || name.starts_with("eth")
        || name.starts_with("wlan")
        || name.starts_with("wl")
}

fn is_likely_virtual_interface(name: &str) -> bool {
    name.starts_with("utun")
        || name.starts_with("tun")
        || name.starts_with("tap")
        || name.starts_with("docker")
        || name.starts_with("veth")
}

#[cfg(unix)]
fn interface_ipv4_candidates() -> Vec<Ipv4Interface> {
    use std::{ffi::CStr, ptr};

    let mut interfaces = ptr::null_mut();
    if unsafe { libc::getifaddrs(&mut interfaces) } != 0 {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    let mut current = interfaces;
    while !current.is_null() {
        let interface = unsafe { &*current };
        let is_up = interface.ifa_flags & libc::IFF_UP as u32 != 0;
        let is_loopback = interface.ifa_flags & libc::IFF_LOOPBACK as u32 != 0;
        let is_point_to_point = interface.ifa_flags & libc::IFF_POINTOPOINT as u32 != 0;
        if is_up && !is_loopback && !is_point_to_point && !interface.ifa_addr.is_null() {
            let socket_address = unsafe { &*interface.ifa_addr };
            if socket_address.sa_family as i32 == libc::AF_INET {
                let socket_address = unsafe { &*(interface.ifa_addr as *const libc::sockaddr_in) };
                let address = Ipv4Addr::from(u32::from_be(socket_address.sin_addr.s_addr));
                if is_usable_interface_address(address) {
                    let name = unsafe { CStr::from_ptr(interface.ifa_name) }
                        .to_string_lossy()
                        .into_owned();
                    let netmask = if interface.ifa_netmask.is_null() {
                        Ipv4Addr::UNSPECIFIED
                    } else {
                        let netmask =
                            unsafe { &*(interface.ifa_netmask as *const libc::sockaddr_in) };
                        Ipv4Addr::from(u32::from_be(netmask.sin_addr.s_addr))
                    };
                    candidates.push(Ipv4Interface {
                        name,
                        address,
                        netmask,
                    });
                }
            }
        }
        current = interface.ifa_next;
    }
    unsafe { libc::freeifaddrs(interfaces) };
    candidates
}

#[cfg(not(unix))]
fn interface_ipv4_candidates() -> Vec<Ipv4Interface> {
    Vec::new()
}

fn routed_local_ipv4() -> Option<Ipv4Addr> {
    // Multicast traffic normally follows the physical LAN route instead of a
    // VPN's catch-all route. The second target keeps the previous fallback for
    // platforms where multicast route probing is unavailable.
    ["224.0.0.251:5353", "192.0.2.1:80"]
        .into_iter()
        .find_map(|target| {
            UdpSocket::bind("0.0.0.0:0")
                .and_then(|socket| {
                    socket.connect(target)?;
                    socket.local_addr()
                })
                .ok()
                .and_then(|address| match address.ip() {
                    IpAddr::V4(address) if is_usable_interface_address(address) => Some(address),
                    _ => None,
                })
        })
}

fn is_usable_interface_address(address: Ipv4Addr) -> bool {
    !address.is_unspecified()
        && !address.is_loopback()
        && !address.is_multicast()
        && address != Ipv4Addr::BROADCAST
        && !is_benchmark_address(address)
}

fn is_benchmark_address(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 198 && (18..=19).contains(&octets[1])
}

fn broadcast_targets() -> Vec<SocketAddr> {
    let mut targets = HashSet::new();
    for interface in interface_ipv4_candidates() {
        if !is_local_network_address(IpAddr::V4(interface.address))
            || interface.netmask.is_unspecified()
        {
            continue;
        }
        let broadcast =
            Ipv4Addr::from(u32::from(interface.address) | !u32::from(interface.netmask));
        if broadcast != interface.address && broadcast != Ipv4Addr::BROADCAST {
            targets.insert(SocketAddr::from((broadcast, DISCOVERY_PORT)));
        }
    }
    targets.insert(SocketAddr::from((Ipv4Addr::BROADCAST, DISCOVERY_PORT)));
    targets.into_iter().collect()
}

fn advertise_share(stop: Arc<AtomicBool>, announcement: LanShareAnnouncement) {
    let Ok(socket) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else {
        return;
    };
    if socket.set_broadcast(true).is_err() {
        return;
    }
    let Ok(payload) = serde_json::to_vec(&announcement) else {
        return;
    };
    let mut packet = Vec::with_capacity(DISCOVERY_MAGIC.len() + payload.len());
    packet.extend_from_slice(DISCOVERY_MAGIC);
    packet.extend_from_slice(&payload);
    if packet.len() > MAX_DISCOVERY_PACKET_BYTES {
        return;
    }

    let targets = broadcast_targets();
    while !stop.load(Ordering::Acquire) {
        for target in &targets {
            let _ = socket.send_to(&packet, target);
        }
        thread::sleep(DISCOVERY_INTERVAL);
    }
}

pub fn start_discovery(app: AppHandle, state: AppState) {
    let _ = thread::Builder::new()
        .name("libr-lan-discovery".into())
        .spawn(move || discover_shares(app, state));
}

fn discover_shares(app: AppHandle, state: AppState) {
    let socket = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT)) {
        Ok(socket) => socket,
        Err(error) => {
            eprintln!("无法启动局域网分享发现：{error}");
            return;
        }
    };
    let _ = socket.set_read_timeout(Some(Duration::from_secs(1)));
    let mut buffer = [0_u8; MAX_DISCOVERY_PACKET_BYTES];

    loop {
        let mut changed = false;
        match socket.recv_from(&mut buffer) {
            Ok((length, peer)) => {
                if let Some(share) =
                    parse_discovery_packet(&buffer[..length], peer, &state.lan_share_instance_id)
                {
                    let mut discovered = state.discovered_lan_shares.lock();
                    changed = discovered
                        .get(&share.id)
                        .map_or(true, |(current, _)| current != &share);
                    discovered.insert(share.id.clone(), (share, Instant::now()));
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(error) => {
                eprintln!("局域网分享发现已停止：{error}");
                break;
            }
        }

        let now = Instant::now();
        let mut discovered = state.discovered_lan_shares.lock();
        let previous_length = discovered.len();
        discovered.retain(|_, (_, last_seen)| now.duration_since(*last_seen) < DISCOVERY_EXPIRY);
        changed |= previous_length != discovered.len();
        drop(discovered);
        if changed {
            let _ = app.emit("lan-shares-changed", ());
        }
    }
}

fn parse_discovery_packet(
    packet: &[u8],
    peer: SocketAddr,
    own_instance_id: &str,
) -> Option<DiscoveredLanShare> {
    let payload = packet.strip_prefix(DISCOVERY_MAGIC)?;
    let announcement: LanShareAnnouncement = serde_json::from_slice(payload).ok()?;
    if announcement.instance_id == own_instance_id
        || announcement.instance_id.len() != 32
        || !announcement
            .instance_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || announcement.token.len() != 32
        || !announcement
            .token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || announcement.port == 0
        || announcement.device_name.trim().is_empty()
        || announcement.device_name.len() > 128
        || announcement.folder_name.trim().is_empty()
        || announcement.folder_name.len() > 255
        || !matches!(announcement.permission.as_str(), "readOnly" | "manage")
        || !is_local_network_address(peer.ip())
    {
        return None;
    }
    let IpAddr::V4(peer_address) = peer.ip() else {
        return None;
    };

    Some(DiscoveredLanShare {
        id: announcement.instance_id,
        device_name: announcement.device_name,
        folder_name: announcement.folder_name,
        permission: announcement.permission,
        url: format!(
            "http://{}:{}/share/{}",
            peer_address, announcement.port, announcement.token
        ),
    })
}

pub fn discovered_shares(state: &AppState) -> Vec<DiscoveredLanShare> {
    let mut shares: Vec<_> = state
        .discovered_lan_shares
        .lock()
        .values()
        .map(|(share, _)| share.clone())
        .collect();
    shares.sort_by(|left, right| {
        left.device_name
            .to_lowercase()
            .cmp(&right.device_name.to_lowercase())
            .then_with(|| {
                left.folder_name
                    .to_lowercase()
                    .cmp(&right.folder_name.to_lowercase())
            })
    });
    shares
}

pub fn open_discovered_share(state: &AppState, share_id: &str) -> LibrResult<()> {
    let share = state
        .discovered_lan_shares
        .lock()
        .get(share_id)
        .map(|(share, _)| share.clone())
        .ok_or_else(|| LibrError::Other("该局域网分享已离线".into()))?;
    opener::open(share.url).map_err(|error| LibrError::Other(error.to_string()))?;
    Ok(())
}

#[cfg(unix)]
fn device_name() -> String {
    use std::ffi::CStr;

    let mut buffer = [0_i8; 256];
    if unsafe { libc::gethostname(buffer.as_mut_ptr(), buffer.len()) } == 0 {
        buffer[255] = 0;
        let hostname = unsafe { CStr::from_ptr(buffer.as_ptr()) }
            .to_string_lossy()
            .trim()
            .trim_end_matches(".local")
            .to_owned();
        if !hostname.is_empty() {
            return hostname;
        }
    }
    "Libr 用户".into()
}

#[cfg(not(unix))]
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Libr 用户".into())
}

fn serve(listener: TcpListener, app: AppHandle, state: AppState, config: ShareConfig) {
    while !config.stop.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !is_local_network_address(peer.ip()) {
                    write_text(
                        &mut stream,
                        403,
                        "text/plain; charset=utf-8",
                        "仅允许局域网访问",
                    );
                    continue;
                }
                let app = app.clone();
                let state = state.clone();
                let config = config.clone();
                let _ = thread::Builder::new()
                    .name("libr-lan-client".into())
                    .spawn(move || handle_connection(stream, &app, &state, &config));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(60));
            }
            Err(_) => break,
        }
    }
}

fn is_local_network_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || is_shared_address(address)
        }
        IpAddr::V6(address) => {
            address.is_loopback() || address.is_unique_local() || address.is_unicast_link_local()
        }
    }
}

fn is_shared_address(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn handle_connection(
    mut stream: TcpStream,
    app: &AppHandle,
    state: &AppState,
    config: &ShareConfig,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    if config.stop.load(Ordering::Acquire) {
        return write_text(&mut stream, 410, "text/plain; charset=utf-8", "共享已停止");
    }
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(_) => return write_text(&mut stream, 400, "text/plain; charset=utf-8", "请求无效"),
    };
    let path = request.target.split('?').next().unwrap_or_default();
    let base = format!("/share/{}", config.token);
    if path != base && !path.starts_with(&format!("{base}/")) {
        return write_text(&mut stream, 404, "text/plain; charset=utf-8", "未找到");
    }
    let suffix = path.strip_prefix(&base).unwrap_or_default();
    match (request.method.as_str(), suffix) {
        ("GET", "" | "/") => write_html(&mut stream, &share_page(config)),
        ("GET", "/api/assets") => send_asset_list(&mut stream, state, config),
        _ if suffix.starts_with("/preview/") && request.method == "GET" => {
            let asset_id = &suffix[9..];
            send_asset_bytes(&mut stream, state, config, asset_id, true, &request);
        }
        _ if suffix.starts_with("/asset/") && request.method == "GET" => {
            let asset_id = &suffix[7..];
            send_asset_bytes(&mut stream, state, config, asset_id, false, &request);
        }
        _ if suffix.starts_with("/api/assets/") && request.method == "POST" => {
            let asset_id = &suffix[12..];
            mutate_asset(&mut stream, app, state, config, asset_id, &request.body);
        }
        _ => write_text(&mut stream, 404, "text/plain; charset=utf-8", "未找到"),
    }
}

fn read_request(stream: &mut TcpStream) -> std::io::Result<HttpRequest> {
    let mut data = Vec::with_capacity(4096);
    let mut buffer = [0u8; 4096];
    let header_end;
    loop {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "请求不完整",
            ));
        }
        data.extend_from_slice(&buffer[..read]);
        if data.len() > MAX_REQUEST_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "请求过大",
            ));
        }
        if let Some(index) = data.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
    }
    let header_text = std::str::from_utf8(&data[..header_end - 4])
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "请求头不是 UTF-8"))?;
    let mut lines = header_text.split("\r\n");
    let mut first = lines.next().unwrap_or_default().split_whitespace();
    let method = first.next().unwrap_or_default().to_owned();
    let target = first.next().unwrap_or_default().to_owned();
    if method.is_empty() || target.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "缺少请求行",
        ));
    }
    let headers: HashMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect();
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if header_end + content_length > MAX_REQUEST_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "请求体过大",
        ));
    }
    while data.len() < header_end + content_length {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&buffer[..read]);
    }
    if data.len() < header_end + content_length {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "请求体不完整",
        ));
    }
    Ok(HttpRequest {
        method,
        target,
        headers,
        body: data[header_end..header_end + content_length].to_vec(),
    })
}

fn blocked_folder_ids(session: &db::LibrarySession) -> LibrResult<HashSet<String>> {
    Ok(db::folder_lock_owners(session, &HashSet::new())?
        .into_keys()
        .collect())
}

fn shared_folder_ids(session: &db::LibrarySession, root_id: &str) -> LibrResult<HashSet<String>> {
    let folders = db::list_folders(session)?;
    let mut ids = HashSet::from([root_id.to_owned()]);
    loop {
        let before = ids.len();
        for folder in &folders {
            if folder
                .parent_id
                .as_ref()
                .is_some_and(|parent| ids.contains(parent))
            {
                ids.insert(folder.id.clone());
            }
        }
        if ids.len() == before {
            break;
        }
    }
    Ok(ids)
}

fn asset_is_shared(asset: &Asset, shared_ids: &HashSet<String>) -> bool {
    asset
        .folder_ids
        .iter()
        .any(|folder_id| shared_ids.contains(folder_id))
}

fn send_asset_list(stream: &mut TcpStream, state: &AppState, config: &ShareConfig) {
    if config.stop.load(Ordering::Acquire) {
        return write_text(stream, 410, "text/plain; charset=utf-8", "共享已停止");
    }
    let result = (|| -> LibrResult<Vec<SharedAsset>> {
        let guard = state.session.lock();
        if config.stop.load(Ordering::Acquire) {
            return Err(LibrError::Other("共享已停止".into()));
        }
        let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
        let blocked = blocked_folder_ids(session)?;
        let folder_ids = shared_folder_ids(session, &config.folder_id)?;
        let mut assets = HashMap::<String, Asset>::new();
        for folder_id in folder_ids {
            let query = SearchQuery {
                folder_id: Some(folder_id),
                sort_by: Some("name".into()),
                sort_direction: Some("asc".into()),
                limit: Some(5000),
                ..Default::default()
            };
            for asset in db::list_assets_with_blocked_folders(session, &query, &blocked)? {
                assets.entry(asset.id.clone()).or_insert(asset);
            }
        }
        let mut assets: Vec<_> = assets.into_values().map(SharedAsset::from).collect();
        assets.sort_by(|left, right| {
            left.display_name
                .to_lowercase()
                .cmp(&right.display_name.to_lowercase())
        });
        Ok(assets)
    })();
    match result.and_then(|assets| serde_json::to_vec(&assets).map_err(Into::into)) {
        Ok(json) => write_response(stream, 200, "application/json; charset=utf-8", &[], &json),
        Err(error) => write_text(stream, 500, "text/plain; charset=utf-8", &error.to_string()),
    }
}

fn send_asset_bytes(
    stream: &mut TcpStream,
    state: &AppState,
    config: &ShareConfig,
    asset_id: &str,
    preview: bool,
    request: &HttpRequest,
) {
    let guard = state.session.lock();
    if config.stop.load(Ordering::Acquire) {
        return write_text(stream, 410, "text/plain; charset=utf-8", "共享已停止");
    }
    let Some(session) = guard.as_ref() else {
        return write_text(stream, 404, "text/plain; charset=utf-8", "资源库已关闭");
    };
    let shared_ids = match shared_folder_ids(session, &config.folder_id) {
        Ok(ids) => ids,
        Err(error) => {
            return write_text(stream, 500, "text/plain; charset=utf-8", &error.to_string())
        }
    };
    let asset = match db::get_asset(session, asset_id) {
        Ok(asset) if asset.deleted_at.is_none() && asset_is_shared(&asset, &shared_ids) => asset,
        _ => return write_text(stream, 404, "text/plain; charset=utf-8", "资源不存在"),
    };
    let blocked = match blocked_folder_ids(session) {
        Ok(ids) => ids,
        Err(error) => {
            return write_text(stream, 500, "text/plain; charset=utf-8", &error.to_string())
        }
    };
    if db::ensure_assets_accessible(session, &[asset.id.clone()], &blocked).is_err() {
        return write_text(stream, 403, "text/plain; charset=utf-8", "资源已锁定");
    }
    let (mime, total) = match db::protocol_metadata(session, asset_id, preview) {
        Ok(metadata) => metadata,
        Err(_) => return write_text(stream, 404, "text/plain; charset=utf-8", "预览不可用"),
    };
    if let Some(range) = request
        .headers
        .get("range")
        .and_then(|value| protocol::parse_range(value, total))
    {
        let (start, end, _) = range;
        let length = usize::try_from(end.saturating_sub(start) + 1).unwrap_or(MAX_RANGE_BYTES);
        return match db::protocol_blob(session, asset_id, preview, start, length) {
            Ok((data, _, _)) => write_response(
                stream,
                206,
                &mime,
                &[
                    ("Accept-Ranges", "bytes".into()),
                    ("Content-Range", format!("bytes {start}-{end}/{total}")),
                ],
                &data,
            ),
            Err(error) => write_text(stream, 500, "text/plain; charset=utf-8", &error.to_string()),
        };
    }
    if preview {
        return match db::protocol_blob(session, asset_id, true, 0, total as usize) {
            Ok((data, _, _)) => write_response(
                stream,
                200,
                &mime,
                &[("Cache-Control", "private, max-age=300".into())],
                &data,
            ),
            Err(error) => write_text(stream, 500, "text/plain; charset=utf-8", &error.to_string()),
        };
    }
    let disposition = if request.target.contains("download=1") {
        format!(
            "attachment; filename*=UTF-8''{}",
            percent_encode(&asset.display_name)
        )
    } else {
        "inline".into()
    };
    if write_headers(
        stream,
        200,
        &mime,
        total,
        &[
            ("Accept-Ranges", "bytes".into()),
            ("Content-Disposition", disposition),
        ],
    )
    .is_err()
    {
        return;
    }
    let mut offset = 0u64;
    while offset < total && !config.stop.load(Ordering::Acquire) {
        let length = usize::try_from((total - offset).min(MAX_RANGE_BYTES as u64))
            .unwrap_or(MAX_RANGE_BYTES);
        let Ok((data, _, _)) = db::protocol_blob(session, asset_id, false, offset, length) else {
            break;
        };
        if data.is_empty() || stream.write_all(&data).is_err() {
            break;
        }
        offset += data.len() as u64;
    }
}

fn mutate_asset(
    stream: &mut TcpStream,
    app: &AppHandle,
    state: &AppState,
    config: &ShareConfig,
    asset_id: &str,
    body: &[u8],
) {
    if !config.allow_editing {
        return write_text(stream, 403, "text/plain; charset=utf-8", "此共享仅允许查看");
    }
    if config.stop.load(Ordering::Acquire) {
        return write_text(stream, 410, "text/plain; charset=utf-8", "共享已停止");
    }
    let mutation: SharedAssetMutation = match serde_json::from_slice(body) {
        Ok(mutation) => mutation,
        Err(_) => return write_text(stream, 400, "text/plain; charset=utf-8", "操作内容无效"),
    };
    let result = (|| -> LibrResult<()> {
        let mut guard = state.session.lock();
        if config.stop.load(Ordering::Acquire) {
            return Err(LibrError::Other("共享已停止".into()));
        }
        let session = guard.as_ref().ok_or(LibrError::NoLibrary)?;
        let shared_ids = shared_folder_ids(session, &config.folder_id)?;
        let blocked = blocked_folder_ids(session)?;
        let asset = db::get_asset(session, asset_id)?;
        if asset.deleted_at.is_some() || !asset_is_shared(&asset, &shared_ids) {
            return Err(LibrError::AssetNotFound);
        }
        db::ensure_assets_accessible(session, &[asset_id.to_owned()], &blocked)?;
        if mutation.trash == Some(true) {
            return db::set_assets_deleted(
                guard.as_mut().ok_or(LibrError::NoLibrary)?,
                &[asset_id.to_owned()],
                true,
            );
        }
        if let Some(name) = &mutation.display_name {
            let trimmed = name.trim();
            if trimmed.is_empty()
                || trimmed.chars().count() > 255
                || trimmed
                    .chars()
                    .any(|character| character.is_control() || matches!(character, '/' | '\\'))
            {
                return Err(LibrError::Other(
                    "资源名称不能为空、不能包含路径字符，且不能超过 255 个字符".into(),
                ));
            }
        }
        let patch = AssetPatch {
            display_name: mutation.display_name,
            favorite: mutation.favorite,
            rating: mutation.rating,
            notes: mutation.notes,
            ..Default::default()
        };
        db::update_asset(
            guard.as_mut().ok_or(LibrError::NoLibrary)?,
            asset_id,
            &patch,
        )?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            let _ = app.emit("library-changed", "lan-share");
            write_text(
                stream,
                200,
                "application/json; charset=utf-8",
                "{\"ok\":true}",
            );
        }
        Err(error) => write_text(stream, 400, "text/plain; charset=utf-8", &error.to_string()),
    }
}

fn write_html(stream: &mut TcpStream, html: &str) {
    write_response(
        stream,
        200,
        "text/html; charset=utf-8",
        &[
            ("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'".into()),
            ("X-Content-Type-Options", "nosniff".into()),
            ("Referrer-Policy", "no-referrer".into()),
        ],
        html.as_bytes(),
    )
}

fn write_text(stream: &mut TcpStream, status: u16, mime: &str, text: &str) {
    write_response(stream, status, mime, &[], text.as_bytes())
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    mime: &str,
    extra: &[(&str, String)],
    body: &[u8],
) {
    if write_headers(stream, status, mime, body.len() as u64, extra).is_ok() {
        let _ = stream.write_all(body);
    }
}

fn write_headers(
    stream: &mut TcpStream,
    status: u16,
    mime: &str,
    length: u64,
    extra: &[(&str, String)],
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        410 => "Gone",
        _ => "Internal Server Error",
    };
    write!(stream, "HTTP/1.1 {status} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {length}\r\nConnection: close\r\n")?;
    for (name, value) in extra {
        write!(stream, "{name}: {value}\r\n")?;
    }
    write!(stream, "\r\n")
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn share_page(config: &ShareConfig) -> String {
    let folder_name = html_escape(&config.folder_name);
    let can_edit = if config.allow_editing {
        "true"
    } else {
        "false"
    };
    format!(
        r###"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{folder_name} · Libr 共享</title><style>
:root{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;color:#172033;background:#f4f6fa}}*{{box-sizing:border-box}}body{{margin:0}}header{{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:18px clamp(18px,5vw,64px);background:rgba(255,255,255,.92);border-bottom:1px solid #dde2ea;backdrop-filter:blur(16px)}}h1{{margin:0;font-size:20px}}.brand{{display:flex;gap:12px;align-items:center}}.logo{{display:grid;width:36px;height:36px;place-items:center;color:#fff;font-weight:800;background:#246bfe;border-radius:10px}}.permission{{padding:6px 10px;color:#526078;font-size:12px;background:#edf2fb;border-radius:999px}}main{{max-width:1180px;margin:auto;padding:28px clamp(18px,5vw,64px) 60px}}.tools{{display:flex;gap:12px;margin-bottom:22px}}input{{width:min(420px,100%);height:40px;padding:0 13px;border:1px solid #d7dde7;border-radius:9px;background:#fff;font:inherit}}.count{{margin-left:auto;align-self:center;color:#778196;font-size:13px}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}}article{{overflow:hidden;background:#fff;border:1px solid #e0e4eb;border-radius:13px;box-shadow:0 3px 12px rgba(35,45,66,.05)}}.preview{{display:grid;height:146px;place-items:center;overflow:hidden;color:#788399;background:#eef1f6}}.preview img{{width:100%;height:100%;object-fit:cover}}.meta{{padding:12px}}.name{{overflow:hidden;margin:0 0 7px;font-size:14px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}}.sub{{display:flex;justify-content:space-between;color:#8a93a4;font-size:11px}}.actions{{display:flex;gap:6px;padding:0 12px 12px}}button,a.button{{display:inline-flex;height:32px;align-items:center;justify-content:center;padding:0 10px;color:#33405a;text-decoration:none;background:#f4f6f9;border:0;border-radius:7px;cursor:pointer}}button:hover,a.button:hover{{background:#e6ecf7}}button.danger{{margin-left:auto;color:#c43838}}.empty{{grid-column:1/-1;padding:80px 20px;color:#8791a3;text-align:center}}dialog{{width:min(420px,calc(100% - 32px));padding:22px;border:0;border-radius:14px;box-shadow:0 24px 80px rgba(25,34,50,.25)}}dialog::backdrop{{background:rgba(26,32,44,.35)}}dialog h2{{margin-top:0}}dialog input{{width:100%}}dialog menu{{display:flex;justify-content:flex-end;gap:8px;margin:20px 0 0;padding:0}}@media(max-width:560px){{.grid{{grid-template-columns:repeat(2,minmax(0,1fr))}}.preview{{height:110px}}.actions{{flex-wrap:wrap}}}}
</style></head><body><header><div class="brand"><span class="logo">L</span><div><h1>{folder_name}</h1><small>Libr 局域网共享</small></div></div><span class="permission">{}</span></header><main><div class="tools"><input id="search" type="search" placeholder="搜索共享资源…"><span class="count" id="count"></span></div><section class="grid" id="grid"><div class="empty">正在加载…</div></section></main><dialog id="rename"><form method="dialog"><h2>重命名资源</h2><input id="renameInput" maxlength="255"><menu><button value="cancel">取消</button><button value="confirm">保存</button></menu></form></dialog><script>
const canEdit={can_edit},base=location.pathname.replace(/\/$/,''),grid=document.querySelector('#grid'),count=document.querySelector('#count'),search=document.querySelector('#search'),dialog=document.querySelector('#rename'),renameInput=document.querySelector('#renameInput');let assets=[],active=null;
const size=n=>n<1024*1024?(n/1024).toFixed(n<10240?1:0)+' KB':(n/1024/1024).toFixed(1)+' MB';const esc=s=>String(s).replace(/[&<>"']/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]));
async function load(){{const response=await fetch(base+'/api/assets',{{cache:'no-store'}});if(!response.ok)throw Error(await response.text());assets=await response.json();render()}}
function render(){{const term=search.value.trim().toLocaleLowerCase();const list=assets.filter(a=>a.displayName.toLocaleLowerCase().includes(term));count.textContent=list.length+'项资源';grid.innerHTML=list.length?list.map(a=>`<article><div class="preview">${{a.hasPreview?`<img loading="lazy" src="${{base}}/preview/${{a.id}}" alt="">`:`<span>${{esc(a.kind.toUpperCase())}}</span>`}}</div><div class="meta"><p class="name" title="${{esc(a.displayName)}}">${{a.favorite?'★ ':''}}${{esc(a.displayName)}}</p><div class="sub"><span>${{size(a.byteSize)}}</span><span>${{a.rating?'★'.repeat(a.rating):''}}</span></div></div><div class="actions"><a class="button" href="${{base}}/asset/${{a.id}}?download=1">下载</a>${{canEdit?`<button onclick="rename('${{a.id}}')">重命名</button><button onclick="toggleFavorite('${{a.id}}',${{!a.favorite}})">${{a.favorite?'取消收藏':'收藏'}}</button><button class="danger" onclick="trash('${{a.id}}')">删除</button>`:''}}</div></article>`).join(''):'<div class="empty">没有找到资源</div>'}}
async function update(id,patch){{const response=await fetch(base+'/api/assets/'+id,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(patch)}});if(!response.ok)throw Error(await response.text());await load()}}function rename(id){{active=id;renameInput.value=assets.find(a=>a.id===id).displayName;dialog.showModal();renameInput.focus();renameInput.select()}}dialog.addEventListener('close',()=>{{if(dialog.returnValue==='confirm'&&renameInput.value.trim())update(active,{{displayName:renameInput.value.trim()}}).catch(e=>alert(e.message))}});function toggleFavorite(id,value){{update(id,{{favorite:value}}).catch(e=>alert(e.message))}}function trash(id){{const a=assets.find(x=>x.id===id);if(confirm('确定将“'+a.displayName+'”移到回收站吗？'))update(id,{{trash:true}}).catch(e=>alert(e.message))}}search.addEventListener('input',render);load().catch(e=>grid.innerHTML='<div class="empty">'+esc(e.message)+'</div>');
</script></body></html>"###,
        if config.allow_editing {
            "可管理"
        } else {
            "仅查看"
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_shared_folder_name_in_html() {
        let config = ShareConfig {
            folder_id: "folder".into(),
            folder_name: "<script>alert('x')</script>".into(),
            token: "token".into(),
            allow_editing: false,
            stop: Arc::new(AtomicBool::new(false)),
        };
        let page = share_page(&config);
        assert!(!page.contains("<script>alert('x')</script>"));
        assert!(page.contains("&lt;script&gt;"));
    }

    #[test]
    fn percent_encodes_download_names() {
        assert_eq!(
            percent_encode("设计 稿.png"),
            "%E8%AE%BE%E8%AE%A1%20%E7%A8%BF.png"
        );
    }

    #[test]
    fn only_accepts_local_network_addresses() {
        assert!(is_local_network_address("192.168.1.20".parse().unwrap()));
        assert!(is_local_network_address("10.20.30.40".parse().unwrap()));
        assert!(is_local_network_address("100.64.1.2".parse().unwrap()));
        assert!(is_local_network_address("127.0.0.1".parse().unwrap()));
        assert!(!is_local_network_address("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn prefers_physical_private_address_over_virtual_and_benchmark_addresses() {
        let candidates = vec![
            Ipv4Interface {
                name: "utun6".to_owned(),
                address: "198.18.0.1".parse().unwrap(),
                netmask: "255.255.255.252".parse().unwrap(),
            },
            Ipv4Interface {
                name: "bridge100".to_owned(),
                address: "172.16.0.1".parse().unwrap(),
                netmask: "255.255.255.0".parse().unwrap(),
            },
            Ipv4Interface {
                name: "en1".to_owned(),
                address: "192.168.2.22".parse().unwrap(),
                netmask: "255.255.255.0".parse().unwrap(),
            },
        ];
        let selected = candidates
            .into_iter()
            .filter(|interface| is_usable_interface_address(interface.address))
            .max_by_key(|interface| local_ipv4_score(&interface.name, interface.address));

        assert_eq!(
            selected.unwrap().address,
            "192.168.2.22".parse::<Ipv4Addr>().unwrap()
        );
        assert!(is_benchmark_address("198.18.0.1".parse().unwrap()));
    }

    #[test]
    fn builds_discovered_share_url_from_the_packet_source() {
        let announcement = LanShareAnnouncement {
            instance_id: "a".repeat(32),
            device_name: "小王的 MacBook".into(),
            folder_name: "团队素材".into(),
            permission: "readOnly".into(),
            port: 41783,
            token: "b".repeat(32),
        };
        let mut packet = DISCOVERY_MAGIC.to_vec();
        packet.extend(serde_json::to_vec(&announcement).unwrap());

        let share = parse_discovery_packet(
            &packet,
            "192.168.2.35:51244".parse().unwrap(),
            &"c".repeat(32),
        )
        .unwrap();

        assert_eq!(share.device_name, "小王的 MacBook");
        assert_eq!(share.folder_name, "团队素材");
        assert_eq!(
            share.url,
            format!("http://192.168.2.35:41783/share/{}", "b".repeat(32))
        );
    }

    #[test]
    fn ignores_own_and_non_lan_discovery_packets() {
        let own_id = "a".repeat(32);
        let announcement = LanShareAnnouncement {
            instance_id: own_id.clone(),
            device_name: "My Mac".into(),
            folder_name: "Assets".into(),
            permission: "manage".into(),
            port: 41783,
            token: "b".repeat(32),
        };
        let mut packet = DISCOVERY_MAGIC.to_vec();
        packet.extend(serde_json::to_vec(&announcement).unwrap());

        assert!(
            parse_discovery_packet(&packet, "192.168.2.22:51244".parse().unwrap(), &own_id,)
                .is_none()
        );
        assert!(parse_discovery_packet(
            &packet,
            "198.18.0.1:51244".parse().unwrap(),
            &"c".repeat(32),
        )
        .is_none());
    }
}
