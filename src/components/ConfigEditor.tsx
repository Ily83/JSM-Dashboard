import { useState, type SubmitEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import {
  AUTH_MODE_KEY, CONFIG_FIELDS, CONFIG_GROUPS,
  type ConfigFieldDefinition, type ConfigFieldState, type DesktopConfigResponse, type DesktopConfigSaveResponse,
} from '../../shared/desktopConfig';
import { fetchDesktopConfig, saveDesktopConfig } from '../api/client';
import { primaryButton } from './ui/buttons';

const input = 'h-7 w-full min-w-0 rounded-md border border-line-strong bg-bg px-2 text-xs placeholder:text-subtle disabled:opacity-60';
const LOCKED = 'Set by the computer’s environment';

/** Opens the app again after a save: the address changes with the sign-in method. */
function reopen(result: DesktopConfigSaveResponse, standalone: boolean) {
  const here = globalThis.location;
  const target = new URL(standalone ? '/' : '/#/settings', result.origin);
  if (target.origin === here.origin && target.pathname === here.pathname) here.reload();
  else here.assign(target);
}

interface FieldProps {
  field: ConfigFieldDefinition;
  state: ConfigFieldState;
  value: string;
  onChange: (value: string) => void;
}

function FieldInput({ field, state, value, onChange }: Readonly<FieldProps>) {
  const common = { id: `config-${field.key}`, name: field.key, disabled: state.locked, title: state.locked ? LOCKED : undefined };
  if (field.kind === 'toggle') {
    return (
      <input {...common} type="checkbox" checked={value === 'true'} onChange={(event) => onChange(event.target.checked ? 'true' : 'false')} className="size-4 justify-self-start accent-accent" />
    );
  }
  if (field.kind === 'choice') {
    return (
      <select {...common} value={value} onChange={(event) => onChange(event.target.value)} className={input}>
        {field.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
    );
  }
  if (field.kind === 'secret') {
    return (
      <input {...common} type="password" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)}
        placeholder={state.set ? 'Saved' : 'Not set'} className={input} />
    );
  }
  return (
    <input {...common} type="text" inputMode={field.kind === 'number' ? 'numeric' : undefined} spellCheck={false} autoComplete="off"
      value={value} onChange={(event) => onChange(event.target.value)} placeholder={field.fallback ?? ''} className={input} />
  );
}

/** A toggle is stored as a word; anything else as typed. */
function shown(field: ConfigFieldDefinition, state: ConfigFieldState): string {
  if (field.kind === 'secret') return '';
  if (field.kind === 'toggle') return /^(1|true|yes|on)$/i.test(state.value ?? field.fallback ?? '') ? 'true' : 'false';
  if (field.kind === 'choice') return state.value ?? field.fallback ?? '';
  return state.value ?? '';
}

function Editor({ config, standalone, onSaved }: Readonly<{ config: DesktopConfigResponse; standalone: boolean; onSaved: (result: DesktopConfigSaveResponse) => void }>) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const states = new Map(config.fields.map((state) => [state.key, state]));
  const edit = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const valueOf = (field: ConfigFieldDefinition) => draft[field.key] ?? shown(field, states.get(field.key)!);
  const authField = CONFIG_FIELDS.find((field) => field.key === AUTH_MODE_KEY)!;
  const auth = valueOf(authField) === 'oauth' ? 'oauth' : 'basic';

  const changes: Record<string, string | null> = {};
  for (const field of CONFIG_FIELDS) {
    const state = states.get(field.key);
    const next = draft[field.key];
    if (!state || state.locked || next === undefined || next === shown(field, state)) continue;
    // An empty secret means "keep the saved one"; an empty setting falls back to its default.
    if (field.kind === 'secret' && next === '') continue;
    changes[field.key] = next.trim() === '' ? null : next;
  }
  const changed = Object.keys(changes).length > 0;

  const save = useMutation({ mutationFn: saveDesktopConfig, onSuccess: onSaved });
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (changed && !save.isPending) save.mutate({ values: changes });
  };

  return (
    <form aria-label="Configuration file" onSubmit={submit} className="grid gap-4">
      {CONFIG_GROUPS.map((group) => (
        <fieldset key={group.id} className="grid grid-cols-1 items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <legend className="mb-1.5 text-xs font-semibold text-muted">{group.title}</legend>
          {CONFIG_FIELDS.filter((field) => field.group === group.id && (!field.auth || field.auth === auth)).map((field) => (
            <FieldRow key={field.key} field={field} state={states.get(field.key)!} value={valueOf(field)}
              onChange={(value) => edit(field.key, value)} />
          ))}
          {group.id === 'connection' && auth === 'oauth' && (
            <>
              <span className="text-muted">Callback URL to register</span>
              <code className="select-all break-all text-xs">{config.callbackUrl}</code>
            </>
          )}
        </fieldset>
      ))}
      {config.warnings.map((warning) => <p key={warning} className="text-xs text-warn">{warning}</p>)}
      {save.error && <p role="alert" className="text-xs text-crit">{save.error.message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-all text-xs text-subtle">{config.file}</span>
        <span className="flex items-center gap-3">
          {config.oauth && changed && <span className="text-xs text-muted">Saving signs you out.</span>}
          {standalone && <a href="/" className="text-xs font-medium text-accent hover:underline">Back</a>}
          <button type="submit" className={primaryButton} disabled={!changed || save.isPending}>
            <Save size={14} aria-hidden />
            Save and reconnect
          </button>
        </span>
      </div>
    </form>
  );
}

function FieldRow(props: Readonly<FieldProps>) {
  return (
    <>
      <label htmlFor={`config-${props.field.key}`} className="text-muted">{props.field.label}</label>
      <FieldInput {...props} />
    </>
  );
}

/**
 * Desktop app only: edits the settings of the configuration file (.env) that
 * are safe to change from the window, then reconnects. Secrets are write-only.
 */
export function ConfigEditor({ standalone = false, onApplied = reopen }: Readonly<{ standalone?: boolean; onApplied?: (result: DesktopConfigSaveResponse, standalone: boolean) => void }>) {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ['desktop-config'], queryFn: ({ signal }) => fetchDesktopConfig(signal), retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  if (config.isPending) return <div className="skeleton h-5 w-1/2" aria-busy="true" />;
  if (config.error) return <p role="alert" className="text-xs text-crit">{config.error.message}</p>;
  return (
    <Editor
      // A saved configuration starts a fresh form.
      key={config.dataUpdatedAt}
      config={config.data}
      standalone={standalone}
      onSaved={(result) => {
        client.setQueryData(['desktop-config'], result);
        onApplied(result, standalone);
      }}
    />
  );
}
