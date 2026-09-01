type ServerResult = Record<string, never>;
type ServerFn = () => Promise<ServerResult>;

interface PluginExport {
  readonly id: string;
  readonly server: ServerFn;
}

const plugin: PluginExport = {
  id: 'opencode-historian',
  server: async (): Promise<ServerResult> => ({}),
};

export default plugin;
