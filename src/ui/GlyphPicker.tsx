import { useDeferredValue, useState } from 'react';
import { useStore } from '../store';
import { BASIC_CONSONANTS, BASIC_VOWELS, BUL_LABEL, LAYOUT_KEYS, LAYOUT_LABEL, LAYOUT_SAMPLE, type LayoutKey } from '../core/hangul';
import { sampleForKey } from '../core/edit';
import { GlyphIcon } from './glyphs';
import type { Role } from '../core/types';

const ROLE_OF: Record<string, Role> = { cho: 'cho', jung: 'jung', jong: 'jong' };
const ROLE_NAME: Record<string, string> = { cho: '초성', jung: '중성', jong: '종성' };

const SCOPE_TEXT = (key: string) => {
  const [jamo, rest] = key.split('@');
  if (!rest) return jamo;
  if (rest.includes('!')) {
    const [role, syl] = rest.split('!');
    return `${jamo} ${ROLE_NAME[role]} · ‘${syl}’ 전용`;
  }
  const [role, scope] = rest.split('.');
  let s = '';
  if (!scope) s = '';
  else if (scope === 'vert') s = ' · 세로모음 쪽';
  else if (scope === 'horz') s = ' · 가로모음 쪽';
  else if (/^b\d$/.test(scope)) s = ` · ${BUL_LABEL[role as Role][scope] ?? scope}`;
  else s = ` · ${LAYOUT_LABEL[scope as LayoutKey] ?? scope}`;
  return `${jamo} ${ROLE_NAME[role]}${s}`;
};

export function GlyphPicker() {
  const project = useDeferredValue(useStore((s) => s.project));
  const sample = useStore((s) => s.sample);
  const set = useStore((s) => s.set);
  const [text, setText] = useState('');

  const pick = (ch: string, role?: Role) =>
    set({ sample: ch, selNode: null, selStroke: null, ...(role ? { role, part: null } : {}) });

  const variants = Object.keys(project.glyphs).filter((k) => k.includes('@')).sort();
  const latin = Object.entries(project.glyphs).filter(([, g]) => g.kind === 'latin').map(([k]) => k);

  return (
    <div className="picker">
      <form
        className="picker-input"
        onSubmit={(e) => {
          e.preventDefault();
          const ch = [...text.trim()].pop();
          if (ch) pick(ch);
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="편집할 글자 입력 (예: 뷁)"
          aria-label="편집할 글자"
        />
        <button className="btn small" type="submit">열기</button>
      </form>

      <Section title="배치 틀" note="모음 모양·받침 유무에 따라 자모 자리가 정해집니다">
        <div className="chip-grid">
          {LAYOUT_KEYS.map((k) => (
            <Chip key={k} project={project} ch={LAYOUT_SAMPLE[k]} active={sample === LAYOUT_SAMPLE[k]} onClick={() => pick(LAYOUT_SAMPLE[k])} title={LAYOUT_LABEL[k]} />
          ))}
        </div>
      </Section>

      <Section title="기본 자음" note="낱자를 고치면 따로 만든 모양이 없는 모든 글자에 반영됩니다">
        <div className="chip-grid">
          {BASIC_CONSONANTS.map((ch) => (
            <Chip key={ch} project={project} ch={ch} active={sample === ch} onClick={() => pick(ch, 'cho')} title={`${ch} 기본형`} />
          ))}
        </div>
      </Section>

      <Section title="기본 모음">
        <div className="chip-grid">
          {BASIC_VOWELS.map((ch) => (
            <Chip key={ch} project={project} ch={ch} active={sample === ch} onClick={() => pick(ch, 'jung')} title={`${ch} 기본형`} />
          ))}
        </div>
      </Section>

      {variants.length > 0 && (
        <Section title="따로 만든 모양" note="특정 자리·배치에서만 쓰이는 변형">
          <ul className="variant-list">
            {variants.map((k) => {
              const ch = sampleForKey(k);
              const role = ROLE_OF[k.split('@')[1]?.split(/[.!]/)[0] ?? 'cho'];
              return (
                <li key={k}>
                  <button className={sample === ch ? 'variant active' : 'variant'} onClick={() => pick(ch, role)}>
                    <GlyphIcon project={project} ch={ch} size={28} />
                    <span>{SCOPE_TEXT(k)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="라틴 · 숫자 · 기호">
        <div className="chip-grid dense">
          {latin.map((ch) => (
            <Chip key={ch} project={project} ch={ch} active={sample === ch} onClick={() => pick(ch)} title={ch} small />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="picker-section">
      <h3>{title}</h3>
      {note && <p className="note">{note}</p>}
      {children}
    </section>
  );
}

function Chip({
  project, ch, active, onClick, title, small,
}: { project: import('../core/types').Project; ch: string; active: boolean; onClick: () => void; title: string; small?: boolean }) {
  return (
    <button className={active ? 'chip active' : 'chip'} onClick={onClick} title={title} aria-label={title} aria-pressed={active}>
      <GlyphIcon project={project} ch={ch} size={small ? 26 : 32} />
    </button>
  );
}
