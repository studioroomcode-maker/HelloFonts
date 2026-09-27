import { create } from 'zustand';
import type { Project, Role } from './core/types';
import { createProjectFromPreset } from './core/presets';
import type { NodeRef } from './core/edit';
import { getFont, lastCurrent, listFonts, migrateLegacy, newId, putFont, rememberCurrent } from './storage';

const HISTORY_LIMIT = 200;

export type Tool = 'select' | 'pen' | 'ellipse' | 'reference';
export type Tab = 'library' | 'handwriting' | 'edit' | 'preview' | 'table';

interface State {
  ready: boolean;
  fontId: string | null;
  createdAt: number;
  project: Project;
  past: Project[];
  future: Project[];
  tab: Tab;
  sample: string;
  role: Role;
  part: number | null;
  tool: Tool;
  snap: boolean;
  selStroke: number | null;
  selNode: NodeRef | null;
  previewText: string;
  saveState: 'saved' | 'saving' | 'error';

  init: () => Promise<void>;
  openFont: (id: string) => Promise<void>;
  createFont: (project: Project) => Promise<string>;
  commit: (fn: (p: Project) => Project) => void;
  /** 드래그 시작 시 한 번 호출 — 이후 live 변경은 하나의 되돌리기 단위가 된다 */
  beginGesture: () => void;
  live: (fn: (p: Project) => Project) => void;
  undo: () => void;
  redo: () => void;
  replaceProject: (p: Project) => void;
  set: (patch: Partial<Omit<State, 'project' | 'past' | 'future'>>) => void;
}

/** 개발 모드(StrictMode)에서 두 번 불려도 한 번만 초기화 */
let initOnce: Promise<void> | null = null;

const resetEditing = { past: [], future: [], selNode: null, selStroke: null, part: null, role: 'cho' as Role };

export const useStore = create<State>((set, get) => ({
  ready: false,
  fontId: null,
  createdAt: Date.now(),
  project: createProjectFromPreset('round'),
  past: [],
  future: [],
  tab: 'library',
  sample: '한',
  role: 'cho',
  part: null,
  tool: 'select',
  snap: true,
  selStroke: null,
  selNode: null,
  previewText: '다람쥐 헌 쳇바퀴에 타고파\n키스의 고유 조건은 입술끼리 만나야 하고 특별한 기술은 필요치 않다.\nThe quick brown fox jumps over the lazy dog.\n0123456789 !?.,()',
  saveState: 'saved',

  init: () => (initOnce ??= (async () => {
    try {
      await migrateLegacy();
      const fonts = await listFonts();
      const want = lastCurrent();
      const pick = fonts.find((f) => f.id === want) ?? fonts[0];
      if (pick) {
        set({ ...resetEditing, ready: true, fontId: pick.id, createdAt: pick.createdAt, project: pick.project, tab: want ? 'edit' : 'library' });
      } else {
        set({ ready: true, tab: 'library' });
      }
    } catch {
      // IndexedDB를 쓸 수 없는 환경: 저장 없이 작업
      set({ ready: true, saveState: 'error' });
    }
  })()),
  openFont: async (id) => {
    const rec = await getFont(id);
    if (!rec) return;
    rememberCurrent(id);
    set({ ...resetEditing, fontId: id, createdAt: rec.createdAt, project: rec.project, tab: 'edit' });
  },
  createFont: async (project) => {
    const id = newId();
    const now = Date.now();
    await putFont({ id, createdAt: now, updatedAt: now, project });
    rememberCurrent(id);
    set({ ...resetEditing, fontId: id, createdAt: now, project, tab: 'edit' });
    return id;
  },
  commit: (fn) => {
    const { project, past } = get();
    const next = fn(project);
    if (next === project) return;
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
  },
  beginGesture: () => {
    const { project, past } = get();
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
  },
  live: (fn) => set({ project: fn(get().project) }),
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], selNode: null });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], past: [...past, project], future: future.slice(1), selNode: null });
  },
  replaceProject: (p) => set({ project: p, past: [...get().past, get().project], future: [], selNode: null, selStroke: null }),
  set: (patch) => set(patch),
}));

// ── 자동 저장: 편집이 멈추고 잠시 뒤 현재 글꼴을 IndexedDB에 기록 ──
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.project === prev.project || !s.fontId || s.fontId !== prev.fontId) return;
  clearTimeout(saveTimer);
  if (s.saveState !== 'saving') useStore.setState({ saveState: 'saving' });
  saveTimer = setTimeout(() => {
    const { fontId, project, createdAt } = useStore.getState();
    if (!fontId) return;
    putFont({ id: fontId, createdAt, updatedAt: Date.now(), project })
      .then(() => useStore.setState({ saveState: 'saved' }))
      .catch(() => useStore.setState({ saveState: 'error' }));
  }, 600);
});
