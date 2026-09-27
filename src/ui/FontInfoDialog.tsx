import { useEffect } from 'react';
import { useStore } from '../store';
import type { FontInfo } from '../core/types';
import { sanitizeFamilyName } from '../core/project';

const LICENSES = [
  'SIL Open Font License 1.1',
  '개인 사용만 허용',
  '상업적 사용 허용(재배포 금지)',
  'All rights reserved',
];

export function FontInfoDialog({ onClose }: { onClose: () => void }) {
  const info = useStore((s) => s.project.info);
  const live = useStore((s) => s.live);
  const beginGesture = useStore((s) => s.beginGesture);

  useEffect(() => {
    beginGesture();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, beginGesture]);

  const setField = (k: keyof FontInfo, v: string) => live((p) => ({ ...p, info: { ...p.info, [k]: v } }));
  const ascii = sanitizeFamilyName(info.familyName);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="info-title">
        <h2 id="info-title">글꼴 정보</h2>
        <p className="muted small">폰트 파일 안에 기록되어 글꼴 목록·설치 화면에 표시됩니다.</p>
        <div className="field-grid one">
          <label>
            <span>한글 이름 <small className="muted">— 한국어 윈도우·오피스의 글꼴 목록에 표시</small></span>
            <input value={info.familyNameKo} onChange={(e) => setField('familyNameKo', e.target.value)} />
          </label>
          <label>
            <span>영문 이름 <small className="muted">— 파일 이름과 시스템 표준 이름</small></span>
            <input value={info.familyName} onChange={(e) => setField('familyName', e.target.value)} />
            {ascii !== info.familyName && <small className="muted">파일에는 “{ascii}”로 저장됩니다(영문·숫자·공백·하이픈만 사용).</small>}
          </label>
          <label>
            <span>만든 사람</span>
            <input value={info.designer} onChange={(e) => setField('designer', e.target.value)} />
          </label>
          <label>
            <span>버전</span>
            <input value={info.version} onChange={(e) => setField('version', e.target.value)} placeholder="1.000" />
          </label>
          <label>
            <span>저작권 표시</span>
            <input value={info.copyright} onChange={(e) => setField('copyright', e.target.value)} placeholder="© 2026 이름" />
          </label>
          <label>
            <span>사용 허가(라이선스)</span>
            <input list="license-list" value={info.license} onChange={(e) => setField('license', e.target.value)} />
            <datalist id="license-list">
              {LICENSES.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>완료</button>
        </div>
      </div>
    </div>
  );
}
