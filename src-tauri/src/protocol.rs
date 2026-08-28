use std::borrow::Cow;

use tauri::{
    http::{header, Request, Response, StatusCode},
    Manager, UriSchemeContext,
};

use crate::{db, state::AppState};

const MAX_RANGE_BYTES: u64 = 4 * 1024 * 1024;

pub fn respond(
    context: UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path().trim_start_matches('/');
    let mut segments = path.split('/');
    let kind = segments.next().unwrap_or_default();
    let token = segments.next().unwrap_or_default();
    let preview = kind == "preview";
    if !preview && kind != "asset" || token.is_empty() {
        return response(
            StatusCode::BAD_REQUEST,
            "text/plain",
            b"bad request".to_vec(),
            None,
            None,
        );
    }

    let state = context.app_handle().state::<AppState>();
    let Some(asset_id) = state.stream_tokens.lock().resolve(token) else {
        return response(
            StatusCode::UNAUTHORIZED,
            "text/plain",
            b"invalid resource token".to_vec(),
            None,
            None,
        );
    };
    let guard = state.session.lock();
    let Some(session) = guard.as_ref() else {
        return response(
            StatusCode::NOT_FOUND,
            "text/plain",
            b"library closed".to_vec(),
            None,
            None,
        );
    };
    let Ok((mime, total)) = db::protocol_metadata(session, &asset_id, preview) else {
        return response(
            StatusCode::NOT_FOUND,
            "text/plain",
            b"not found".to_vec(),
            None,
            None,
        );
    };

    let parsed = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, total));
    let (start, end, partial) = parsed.unwrap_or((
        0,
        total
            .saturating_sub(1)
            .min(MAX_RANGE_BYTES.saturating_sub(1)),
        total > MAX_RANGE_BYTES,
    ));
    if start >= total || end < start {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Cow::Owned(Vec::new()))
            .unwrap();
    }
    let length = usize::try_from(end - start + 1).unwrap_or(MAX_RANGE_BYTES as usize);
    match db::protocol_blob(session, &asset_id, preview, start, length) {
        Ok((data, _, _)) => response(
            if partial || parsed.is_some() {
                StatusCode::PARTIAL_CONTENT
            } else {
                StatusCode::OK
            },
            &mime,
            data,
            Some((start, end, total)),
            Some(total),
        ),
        Err(_) => response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain",
            b"read failed".to_vec(),
            None,
            None,
        ),
    }
}

fn response(
    status: StatusCode,
    mime: &str,
    data: Vec<u8>,
    range: Option<(u64, u64, u64)>,
    total: Option<u64>,
) -> Response<Cow<'static, [u8]>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(
            header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        )
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_LENGTH, data.len().to_string());
    if let Some((start, end, total)) = range {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{total}"),
        );
    } else if let Some(total) = total {
        builder = builder.header("X-Libr-Total-Length", total.to_string());
    }
    builder.body(Cow::Owned(data)).unwrap()
}

pub fn parse_range(value: &str, total: u64) -> Option<(u64, u64, bool)> {
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(total);
        return Some((total.saturating_sub(suffix), total.saturating_sub(1), true));
    }
    let start = start.parse::<u64>().ok()?;
    let requested_end = if end.is_empty() {
        start.saturating_add(MAX_RANGE_BYTES - 1)
    } else {
        end.parse::<u64>().ok()?
    };
    let end = requested_end
        .min(total.saturating_sub(1))
        .min(start.saturating_add(MAX_RANGE_BYTES - 1));
    Some((start, end, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bounded_ranges() {
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19, true)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99, true)));
        assert_eq!(parse_range("bytes=90-", 100), Some((90, 99, true)));
    }
}
