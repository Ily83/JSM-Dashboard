import { ConfigEditor } from './ConfigEditor';

/**
 * Desktop app only: the configuration file's settings on a page of their own,
 * so the connection can be corrected while signed out.
 */
export function SetupPage() {
  return (
    <div className="h-dvh overflow-y-auto">
      <main className="mx-auto grid max-w-2xl gap-3 p-4">
        <h1 className="text-[15px] font-semibold">Jira Operations – Alert Center</h1>
        <section aria-labelledby="setup-title" className="rounded-lg border border-line bg-panel">
          <h2 id="setup-title" className="flex h-10 items-center border-b border-line px-4 text-[13px] font-semibold">Configuration file</h2>
          <div className="p-4">
            <ConfigEditor standalone />
          </div>
        </section>
      </main>
    </div>
  );
}
