const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');

function transpile(sourcePath, outputPath) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  fs.writeFileSync(outputPath, result.outputText);
}

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gui3-router-runtime-'));
try {
  transpile(path.join(root, 'src/features/router/routerTypes.ts'), path.join(tmp, 'routerTypes.js'));
  transpile(path.join(root, 'src/features/router/routerRuntime.ts'), path.join(tmp, 'routerRuntime.js'));
  const runtime = require(path.join(tmp, 'routerRuntime.js'));

  const router = {
    id: 'user.router', model_name: 'user.router', recipe: 'collection.router', downloaded: true,
    components: ['fast-chat', 'smart-chat', 'route-classifier'],
    routing: {
      candidates: ['fast-chat', 'smart-chat'],
      default_model: 'smart-chat',
      classifiers: [{ id: 'intent', type: 'classifier', model: 'route-classifier' }],
      rules: [{ id: 'intent-route', match: { classifier: 'intent', label: 'match', min_score: 0.5 }, route_to: 'fast-chat' }],
    },
  };
  const models = [
    router,
    { id: 'fast-chat', model_name: 'fast-chat', downloaded: true, recipe: 'llamacpp' },
    { id: 'smart-chat', model_name: 'smart-chat', downloaded: true, recipe: 'llamacpp' },
    { id: 'route-classifier', model_name: 'route-classifier', downloaded: true, recipe: 'llamacpp' },
  ];
  const ok = runtime.preflightRouter(router, models, []);
  assert.equal(ok.ok, true, ok.errors.join(' '));
  assert.deepEqual(ok.dependencies.find(d => d.name === 'route-classifier').roles.sort(), ['classifier', 'component']);

  const missingClassifier = runtime.preflightRouter(router, models.filter(m => m.model_name !== 'route-classifier'), []);
  assert.equal(missingClassifier.ok, false);
  assert.match(runtime.routerPreflightError(missingClassifier), /route-classifier/);
  assert.match(runtime.routerPreflightError(missingClassifier), /not present/i);

  const notDownloaded = runtime.preflightRouter(router, models.map(m => m.model_name === 'route-classifier' ? { ...m, downloaded: false } : m), []);
  assert.equal(notDownloaded.ok, false);
  assert.match(runtime.routerPreflightError(notDownloaded), /not downloaded\/local/i);

  const badDefault = runtime.preflightRouter({ ...router, routing: { ...router.routing, default_model: 'other-chat' } }, models, []);
  assert.equal(badDefault.ok, false);
  assert.match(runtime.routerPreflightError(badDefault), /not in routing\.candidates/i);

  const chat = fs.readFileSync(path.join(root, 'src/components/ChatView.tsx'), 'utf8');
  assert.match(chat, /deferredUntilSend: isRouterModelInfo\(info\) \|\| Boolean\(configuredDefault\)/);
  const routerGuard = chat.indexOf('if (isRouterModelInfo(info)) {', chat.indexOf('const ensureChatModelReady'));
  const ordinaryLoad = chat.indexOf('await loadModelWithPolicy(modelName', routerGuard);
  assert.ok(routerGuard >= 0 && ordinaryLoad > routerGuard, 'Chat readiness must handle Router before ordinary /load');
  assert.match(chat.slice(routerGuard, ordinaryLoad), /preflightRouter/);

  assert.match(chat, /isRouterModelInfo\(selectedInfo\)/, 'Router selection must remain usable without all_models_loaded');
  assert.match(chat, /name="router"[\s\S]*?className="model-mode-icon--router"/, 'virtual Router icon must keep the Router task color in chat');
  const styles = fs.readFileSync(path.join(root, 'src/styles/styles.css'), 'utf8');
  assert.match(styles, /\.model-mode-icon--router\s*\{[\s\S]*?color:\s*var\(--cap-router\)/, 'Router chat icon color must use the shared Router task token');

  const apiSource = fs.readFileSync(path.join(root, 'src/api.ts'), 'utf8');
  assert.match(apiSource, /route_trace/);
  assert.match(apiSource, /Router selected/);

  const editor = fs.readFileSync(path.join(root, 'src/components/RouterEditorPanel.tsx'), 'utf8');
  assert.match(editor, /const dependencyPreflight = preflightRouter\(nextRequest as any, models, \[\]\)/);
  assert.match(editor, /if \(!dependencyPreflight\.ok\)/, 'Router editor must block registration when a dependency preflight fails');

  const routerStore = fs.readFileSync(path.join(root, 'src/features/router/routerStore.ts'), 'utf8');
  assert.match(routerStore, /ROUTER_RECORDS_CHANGED_EVENT/, 'router store changes need a cross-view synchronization event');
  assert.match(routerStore, /dispatchEvent\(new Event\(ROUTER_RECORDS_CHANGED_EVENT\)\)/, 'router persistence must notify mounted views');

  const manager = fs.readFileSync(path.join(root, 'src/components/ModelManager.tsx'), 'utf8');
  assert.match(manager, /if \(isRouterModelInfo\(model\)\) \{[\s\S]*?registerModelDefinition[\s\S]*?preflightRouter/);
  assert.match(manager, /addEventListener\(ROUTER_RECORDS_CHANGED_EVENT/, 'model manager must refresh routers changed by Lemonade tools');

  assert.match(chat, /if \(isRouterRecipe\(currentRecipe\)\) return true;/, 'router chat must accept images so has_images rules are reachable');
  assert.match(chat, /const modeSupportsMcp = modeSupportsChatCompletions;/, 'router chat must retain MCP/Lemonade tool support');
  assert.match(chat, /streaming\.send\(convoId, requestModelName, chatMessages, toolRuntime\)/, 'selected tools must reach router chat requests');

  const tools = fs.readFileSync(path.join(root, 'src/tools/lemonadeTools.ts'), 'utf8');
  const loadCase = tools.slice(tools.indexOf("case 'load_model'"), tools.indexOf("case 'unload_model'"));
  const special = loadCase.indexOf('if (isRouterModel(resolved))');
  const runtimeLoad = loadCase.indexOf('api.loadModel');
  assert.ok(special >= 0 && runtimeLoad > special, 'Tool must finish Router readiness branch before ordinary api.loadModel');
  assert.match(loadCase.slice(special, runtimeLoad), /status: 'ready'/);
  assert.match(loadCase.slice(special, runtimeLoad), /preflightRouter/);

  console.log('GUI3 Router load regression checks passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
