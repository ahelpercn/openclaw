import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { qqPlugin } from "./src/channel.js";
import { setQqRuntime } from "./src/runtime.js";

const plugin = {
  id: "qq",
  name: "QQ",
  description: "QQ channel plugin (Official Bot API)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setQqRuntime(api.runtime);
    api.registerChannel({ plugin: qqPlugin as ChannelPlugin });
  },
};

export default plugin;
