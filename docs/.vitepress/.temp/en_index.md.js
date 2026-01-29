import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"","description":"","frontmatter":{"layout":"home","hero":{"name":"Clawdbot Deep Dive","text":"Technical Guide","tagline":"A comprehensive analysis from architecture to implementation","image":{"src":"/pixel-lobster.svg","alt":"Clawdbot Logo"},"actions":[{"theme":"brand","text":"Start Reading","link":"/en/guide/intro"},{"theme":"alt","text":"GitHub","link":"https://github.com/clawdbot/clawdbot"}]},"features":[{"title":"Multi-Channel Support","details":"Deep dive into the implementation of WhatsApp, Telegram, Discord integrations.","icon":"💬"},{"title":"Tool Ecosystem","details":"Analysis of the built-in tool system and extension mechanisms.","icon":"🛠️"},{"title":"Local-First Architecture","details":"Understanding the security model and local data management.","icon":"🔒"},{"title":"Intelligent Agent","details":"Exploring the Agent runtime, model switching, and memory systems.","icon":"🧠"}]},"headers":[],"relativePath":"en/index.md","filePath":"en/index.md","lastUpdated":null}');
const _sfc_main = { name: "en/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("en/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
