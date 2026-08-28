import { FilePlus2, FolderOpen, LibraryBig, ShieldCheck } from "lucide-react";

interface WelcomeScreenProps {
  onCreate: () => void;
  onOpen: () => void;
}

export function WelcomeScreen({ onCreate, onOpen }: WelcomeScreenProps) {
  return (
    <main className="welcome-screen">
      <div className="welcome-mark"><LibraryBig size={34} /></div>
      <h1>欢迎使用 Libr</h1>
      <p>把图片、音视频和文档收进一个可随身携带的资源库。</p>
      <div className="welcome-actions">
        <button type="button" className="welcome-action is-primary" onClick={onCreate}>
          <FilePlus2 size={23} />
          <span><strong>新建资源库</strong><small>创建一个新的 .libr 文件</small></span>
        </button>
        <button type="button" className="welcome-action" onClick={onOpen}>
          <FolderOpen size={23} />
          <span><strong>打开资源库</strong><small>继续整理已有资源</small></span>
        </button>
      </div>
      <span className="welcome-security"><ShieldCheck size={14} />所有资源仅保存在你的电脑上</span>
    </main>
  );
}
