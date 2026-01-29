import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"","description":"","frontmatter":{"layout":"home","hero":{"name":"Clawdbot 技术解析","text":"深度技术指南","tagline":"从架构设计到代码实现的完全解析，助你深入理解 Clawdbot","image":{"src":"/pixel-lobster.svg","alt":"Clawdbot Logo"},"actions":[{"theme":"brand","text":"开始阅读","link":"/guide/intro"},{"theme":"alt","text":"GitHub 仓库","link":"https://github.com/clawdbot/clawdbot"}]},"features":[{"title":"深度架构分析","details":"深入剖析 Gateway、Agent 运行时及多通道系统的底层实现原理。","icon":"🔍"},{"title":"核心源码解读","details":"解析工具系统、内存管理和安全模型的关键代码逻辑与设计思想。","icon":"💻"},{"title":"最佳实践指南","details":"基于实战经验的部署、运维、性能优化与插件开发建议。","icon":"🚀"},{"title":"个人技术分享","details":"以第三方开发者视角，客观分析 Clawdbot 的技术特点与应用场景。","icon":"📝"}]},"headers":[],"relativePath":"index.md","filePath":"index.md","lastUpdated":null}');
const _sfc_main = { name: "index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
