/**
 * What has actually happened to a document so far, as three lines.
 *
 * The stage is the upload flow's real state, not a timer: a line is ticked
 * only once the server has finished that part, the current one carries a
 * dot, and the rest wait. Nothing is claimed ahead of the machine.
 */

export type UploadStage = 'uploading' | 'checking' | 'reading';

const LINES: readonly { stage: UploadStage; label: string }[] = [
  { stage: 'uploading', label: 'Uploading the document' },
  { stage: 'checking', label: 'Checking the file' },
  { stage: 'reading', label: 'Reading the pages' },
];

export function UploadProgress({ stage }: { stage: UploadStage }): React.ReactElement {
  const current = LINES.findIndex((line) => line.stage === stage);
  return (
    <ol className="progress-list" aria-live="polite" aria-label="Progress">
      {LINES.map((line, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li key={line.stage} data-state={state}>
            <span className="progress-list__mark" aria-hidden />
            <span>
              {line.label}
              {state === 'done' ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
