import { useEffect, useState } from 'react';
import { useStore, type Tab } from './store';
import { Editor } from './ui/Editor';
import { Preview } from './ui/Preview';
import { GlyphTable } from './ui/GlyphTable';
import { ExportDialog } from './ui/ExportDialog';
import { Library } from './ui/Library';
import { FontInfoDialog } from './ui/FontInfoDialog';
import { HandwritingWizard } from './ui/handwriting/HandwritingWizard';

const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: '내 글꼴' },
  { id: 'handwriting', label: '손글씨로 만들기' },
  { id: 'edit', label: '글자 편집' },
  { id: 'preview', label: '미리보기' },
  { id: 'table', label: '글자표' },
];

const SAVE_LABEL = { saved: '저장됨', saving: '저장 중…', error: '저장 안 됨' } as const;

export default function App() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const tab = useStore((s) => s.tab);
  const set = useStore((s) => s.set);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const fontId = useStore((s) => s.fontId);
  const info = useStore((s) => s.project.info);
  const saveState = useStore((s) => s.saveState);
  const [exporting, setExporting] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const view: Tab = !fontId && tab !== 'handwriting' ? 'library' : tab;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">가</span>
          <span>HelloFonts</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={view === t.id}
              className={view === t.id ? 'tab active' : 'tab'}
              disabled={!fontId && t.id !== 'library' && t.id !== 'handwriting'}
              onClick={() => set({ tab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-spacer" />
        {fontId && (
          <>
            <button className="font-chip" onClick={() => setEditingInfo(true)} title="글꼴 정보 편집">
              <b>{info.familyNameKo || info.familyName}</b>
              <span className="muted">{info.familyName}</span>
              <span className={`save-dot ${saveState}`} aria-label={SAVE_LABEL[saveState]} title={SAVE_LABEL[saveState]} />
            </button>
            <div className="btn-group">
              <button className="btn icon" onClick={undo} disabled={!canUndo} title="되돌리기 (Ctrl+Z)" aria-label="되돌리기">↶</button>
              <button className="btn icon" onClick={redo} disabled={!canRedo} title="다시 하기 (Ctrl+Y)" aria-label="다시 하기">↷</button>
            </div>
            <button className="btn primary" onClick={() => setExporting(true)}>폰트 파일로 저장</button>
          </>
        )}
      </header>
      <main className="main">
        {!ready ? (
          <p className="muted center">불러오는 중…</p>
        ) : (
          <>
            {view === 'library' && <Library />}
            {view === 'handwriting' && <HandwritingWizard />}
            {view === 'edit' && <Editor />}
            {view === 'preview' && <Preview />}
            {view === 'table' && <GlyphTable />}
          </>
        )}
      </main>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {editingInfo && <FontInfoDialog onClose={() => setEditingInfo(false)} />}
    </div>
  );
}
