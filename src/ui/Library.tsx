import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { deleteFont, listFonts, newId, putFont, type FontRecord } from '../storage';
import { PRESETS, createProjectFromPreset, presetById } from '../core/presets';
import { mergeProject } from '../core/project';
import { GlyphLine } from './glyphs';
import { downloadBytes } from './download';

export function Library() {
  const fontId = useStore((s) => s.fontId);
  const openFont = useStore((s) => s.openFont);
  const current = useStore((s) => s.project);
  const saveState = useStore((s) => s.saveState);
  const [fonts, setFonts] = useState<FontRecord[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => listFonts().then(setFonts).catch(() => setError('저장된 글꼴을 읽을 수 없습니다.'));
  useEffect(() => {
    reload();
  }, [saveState]);

  const duplicate = async (rec: FontRecord) => {
    const now = Date.now();
    const project = structuredClone(rec.project);
    project.info.familyName = `${project.info.familyName} Copy`;
    project.info.familyNameKo = project.info.familyNameKo ? `${project.info.familyNameKo} 사본` : '';
    await putFont({ id: newId(), createdAt: now, updatedAt: now, project });
    reload();
  };

  const exportProject = (rec: FontRecord) => {
    const data = new TextEncoder().encode(JSON.stringify(rec.project));
    downloadBytes(data, `${rec.project.info.familyName || 'font'}.hellofont.json`, 'application/json');
  };

  return (
    <div className="library">
      <div className="library-head">
        <div>
          <h1>내 글꼴</h1>
          <p className="muted">글꼴은 이 브라우저에 자동 저장됩니다. 중요한 작업은 <b>프로젝트 파일로 백업</b>해 두세요.</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => fileRef.current?.click()}>프로젝트 파일 열기…</button>
          <button className="btn" onClick={() => useStore.setState({ tab: 'handwriting' })}>✍ 내 손글씨로 만들기</button>
          <button className="btn primary" onClick={() => setCreating(true)}>＋ 새 글꼴 만들기</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const project = mergeProject(JSON.parse(await f.text()));
              const now = Date.now();
              const id = newId();
              await putFont({ id, createdAt: now, updatedAt: now, project });
              await openFont(id);
            } catch {
              setError('프로젝트 파일을 읽을 수 없습니다.');
            }
          }}
        />
      </div>
      {error && <div className="error">{error}</div>}
      {fonts === null ? (
        <p className="muted">불러오는 중…</p>
      ) : fonts.length === 0 ? (
        <div className="empty-state">
          <p>아직 만든 글꼴이 없습니다.</p>
          <button className="btn primary" onClick={() => setCreating(true)}>첫 글꼴 만들기</button>
        </div>
      ) : (
        <div className="font-grid">
          {fonts.map((rec) => {
            const project = rec.id === fontId ? current : rec.project;
            const preset = project.preset ? presetById(project.preset) : null;
            return (
              <article key={rec.id} className={rec.id === fontId ? 'font-card current' : 'font-card'}>
                <button className="font-card-main" onClick={() => openFont(rec.id)} aria-label={`${project.info.familyName} 열기`}>
                  <div className="font-card-preview">
                    <GlyphLine project={project} text={project.info.familyNameKo || '가나다라'} size={44} />
                    <GlyphLine project={project} text="Aa 가나 123" size={26} />
                  </div>
                  <div className="font-card-meta">
                    <b>{project.info.familyNameKo || project.info.familyName}</b>
                    <span className="muted small">{project.info.familyName}{preset ? ` · ${preset.name}` : ''}</span>
                    <span className="muted small">{new Date(rec.updatedAt).toLocaleString('ko-KR')}</span>
                  </div>
                </button>
                <div className="font-card-actions">
                  <button className="btn small" onClick={() => duplicate(rec)}>복제</button>
                  <button className="btn small" onClick={() => exportProject(rec)}>백업(.json)</button>
                  {confirmDelete === rec.id ? (
                    <button
                      className="btn small danger"
                      onClick={async () => {
                        await deleteFont(rec.id);
                        setConfirmDelete(null);
                        if (rec.id === fontId) useStore.setState({ fontId: null });
                        reload();
                      }}
                    >
                      정말 삭제
                    </button>
                  ) : (
                    <button className="btn small ghost" onClick={() => setConfirmDelete(rec.id)}>삭제</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {creating && <NewFontDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewFontDialog({ onClose }: { onClose: () => void }) {
  const createFont = useStore((s) => s.createFont);
  const [presetId, setPresetId] = useState('round');
  const [nameEn, setNameEn] = useState('My Font');
  const [nameKo, setNameKo] = useState('나의 글꼴');
  const previews = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p.id, createProjectFromPreset(p.id)])), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="new-title">
        <h2 id="new-title">새 글꼴 만들기</h2>
        <p className="muted small">출발점이 될 스타일을 고르세요. 만든 뒤에 굵기·대비·획 끝·필압 등을 마음대로 바꿀 수 있습니다.</p>
        <div className="preset-grid" role="radiogroup" aria-label="스타일">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={presetId === p.id}
              className={presetId === p.id ? 'preset-card active' : 'preset-card'}
              onClick={() => setPresetId(p.id)}
            >
              <GlyphLine project={previews[p.id]} text="한글 Aa" size={40} />
              <b>{p.name}</b>
              <span className="muted small">{p.description}</span>
            </button>
          ))}
        </div>
        <div className="field-grid">
          <label>
            <span>한글 이름</span>
            <input value={nameKo} onChange={(e) => setNameKo(e.target.value)} />
          </label>
          <label>
            <span>영문 이름 <small className="muted">(파일·시스템 이름, 영문·숫자만)</small></span>
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>취소</button>
          <button
            className="btn primary"
            onClick={async () => {
              await createFont(createProjectFromPreset(presetId, nameEn.trim() || 'My Font', nameKo.trim()));
              onClose();
            }}
          >
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}
