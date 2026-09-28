const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createServer } = require('node:http')
const assert = require('node:assert/strict')
const outputDirectory = path.join(__dirname, '../.tmp')
const resultPath = path.join(outputDirectory, 'full-desktop-smoke-result.json')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, label, ms=45000) {
  const deadline = Date.now()+ms
  while (Date.now()<deadline) { const result=await check(); if(result) return result; await delay(150) }
  throw Error('Timeout: '+label)
}
let server, win
const deadline=setTimeout(()=>{void fs.writeFile(resultPath, JSON.stringify({passed:false,error:'Overall timeout'})).then(()=>app.exit(1))},120000)
;(async()=>{
  await fs.mkdir(outputDirectory, {recursive:true})
  const docs=await fs.mkdtemp(path.join(outputDirectory,'desktop-docs-'))
  app.setPath('documents',docs)
  process.env.OPENCODE_TEST_ONBOARDING='1'
  process.env.OPENCODE_SIDECAR_V2='0'
  process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS='false'
  process.env.OPENCODE_DISABLE_MODELS_FETCH='true'
  process.env.OPENCODE_DISABLE_PROJECT_CONFIG='true'
  process.env.OPENCODE_DISABLE_AUTOUPDATE='true'
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) delete process.env[key]
  await import(pathToFileURL(path.join(__dirname,'../upstream/opencode/packages/desktop/out/main/index.js')).href)
  win=await until(()=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()),'desktop window')
  await until(()=>win.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Preview URL"]')`).catch(()=>false),'session preview panel')
  const available=await win.webContents.executeJavaScript('typeof window.api.pixelcrabPreview.show === "function"')
  assert.ok(available)
  const nativeTool=await win.webContents.executeJavaScript(`(async()=>{const server=await window.api.awaitInitialization();const headers=server.password?{Authorization:'Basic '+btoa((server.username||'opencode')+':'+server.password)}:{};const response=await fetch(server.url+'/experimental/tool/ids?directory='+encodeURIComponent(${JSON.stringify(path.join(docs,'Default Project'))}),{headers});if(!response.ok) return false;return (await response.json()).includes('pixelcrabs_preview')})()`)
  assert.ok(nativeTool,'public preview tool is built into the desktop engine')
  server=createServer((_req,res)=>res.end('<!doctype html><html><head><style>body{padding:25px}button{font-size:22px;padding:20px}</style></head><body><button id="test">Test target</button></body></html>'))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url=`http://127.0.0.1:${server.address().port}/`
  await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('[aria-label="Preview URL"]');input.value=${JSON.stringify(url)};input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit()})()`)
  const view=await until(()=>win.contentView.children.find(item=>item.webContents),'native preview view')
  const run=code=>view.webContents.executeJavaScriptInIsolatedWorld(1001,[{code}])
  await until(()=>run('!!document.querySelector("#test")').catch(()=>false),'fixture rendered')
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Point').click()`)
  await until(()=>run('!!globalThis.__pixelcrabElementSelection'),'point tool')
  await run(`document.querySelector('#test').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:80,clientY:80}))`)
  await until(()=>run('!!document.querySelector("[data-pixelcrab-selection-editor]")'),'selection editor')
  await run(`document.querySelector('[data-pixelcrab-selection-editor]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`)
  await until(()=>win.webContents.executeJavaScript('document.body.innerText.includes("Added to the conversation draft")'),'evidence enters native draft')
  const evidenceShown=await win.webContents.executeJavaScript('document.body.innerText.includes("PixelCrab · button#test")')
  assert.ok(evidenceShown,'native composer shows the structured attachment')
  const diagnostics=await win.webContents.executeJavaScript('window.api.pixelcrabPreview.diagnostics({screenshot:true}).then(x=>({visible:x?.render?.hasVisibleContent,screenshot:!!x?.screenshot}))')
  assert.ok(diagnostics.visible)
  await fs.writeFile(resultPath,JSON.stringify({passed:true,nativeTool,nativeSessionEvidence:true,previewVisible:true,screenshotCaptured:diagnostics.screenshot},null,2))
  await win.webContents.executeJavaScript('window.api.killSidecar()')
  await new Promise(resolve=>server.close(resolve))
  clearTimeout(deadline)
  app.exit(0)
})().catch(async error=>{
  const body=win&&!win.isDestroyed()?await win.webContents.executeJavaScript('document.body.innerText.slice(0,1800)').catch(()=>"unavailable"):"unavailable"
  await fs.writeFile(resultPath,JSON.stringify({passed:false,error:error.message,body},null,2))
  if(win&&!win.isDestroyed()) await win.webContents.executeJavaScript('window.api.killSidecar()').catch(()=>{})
  server?.close()
  clearTimeout(deadline)
  app.exit(1)
})
