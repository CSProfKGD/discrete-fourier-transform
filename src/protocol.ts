import type { Point, Preset } from './fourier';

export type Command =
  | { type: 'diameter'; diameter: number; time: number }
  | { type: 'begin'; point: Point; time: number }
  | { type: 'move'; point: Point; time: number }
  | { type: 'end'; time: number }
  | { type: 'preset'; preset: Preset; time: number; reduced: boolean }
  | { type: 'reset'; time: number; reduced: boolean }
  | { type: 'undo'; time: number; reduced: boolean };

export type WorkerInput =
  | { type: 'init'; pixels: Float64Array }
  | { type: 'frame'; sequence: number; time: number; commands: Command[]; hover: number | null;
      spatial?: ArrayBuffer; spectrum?: ArrayBuffer };

export type WorkerOutput =
  | { type: 'ready'; real: Float64Array; imaginary: Float64Array }
  | { type: 'error'; message: string }
  | { type: 'frame'; sequence: number; changed: boolean; spatial?: ArrayBuffer; spectrum?: ArrayBuffer;
      canUndo: boolean; modified: boolean; active: boolean; hover: number | null; hoverGain: number };
