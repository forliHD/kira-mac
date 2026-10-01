// Typen für die 1:1-Kopie aus dem KIRA-Dashboard (src/shared/dictationText.js).
export interface DictationCommandResult {
  text: string;
  op: "undo" | null;
}
export function applyDictationCommands(raw: string, opts?: { enabled?: boolean }): DictationCommandResult;
export function joinDictation(prev: string, next: string): string;
export function insertAtCaret(
  value: string,
  selStart: number | null | undefined,
  selEnd: number | null | undefined,
  text: string,
): { value: string; caret: number; range: { start: number; end: number; text: string } | null };
export function removeInsertion(
  value: string,
  range: { start: number; end: number; text: string } | null,
): { value: string; caret: number } | null;
export function isSilenceHallucination(text: string, spokenMs?: number): boolean;
