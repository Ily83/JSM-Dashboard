import { useEffect, useState } from 'react';
import { ACTION_LABEL, type AlertAction } from '../../../shared/actions';
import { useAlertAction } from '../../api/hooks';

export type RunState =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'done'; label: string; message: string | null }
  | { kind: 'pending'; label: string }
  | { kind: 'error'; label: string; message: string };

/**
 * Runs actions on one alert and keeps a short-lived outcome to show next to
 * the buttons. Success fades after a few seconds; errors stay until the next
 * action.
 */
export function useActionRunner(alertId: string) {
  const mutation = useAlertAction(alertId);
  const [state, setState] = useState<RunState>({ kind: 'idle' });

  useEffect(() => {
    if (state.kind !== 'done') return;
    const timer = setTimeout(() => setState({ kind: 'idle' }), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  const run = async (action: AlertAction): Promise<boolean> => {
    const label = ACTION_LABEL[action.action];
    setState({ kind: 'busy', label });
    try {
      const response = await mutation.mutateAsync(action);
      setState(response.result.state === 'done' ? { kind: 'done', label, message: response.result.message } : { kind: 'pending', label });
      return true;
    } catch (error) {
      setState({ kind: 'error', label, message: error instanceof Error ? error.message : 'The action failed.' });
      return false;
    }
  };

  return { run, state, busy: state.kind === 'busy', dismiss: () => setState({ kind: 'idle' }) };
}
