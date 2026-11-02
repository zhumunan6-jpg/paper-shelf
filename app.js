import {all,get,put,db,removePaper,clearLibrary} from './store.js';
import {importArchive,backupLibrary} from './importer.js';
import {Reader} from './reader.js';
import {$,el,toast,showDialog,closeDialog,confirmDelete,readableBytes} from './ui.js';

let papers=[],states=new Map(),busy=false,restoreMode=false,activeTab='books';
const reader=new Reader({onBack:backToLibrary,onBackup:exportBackup,onShowNotes:showPaperNotes});
const date=value=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(new Date(value));

function importFiles(restore=false) {if(busy)return;restoreMode=restore;$('import-input').value='';$('import-input').click();}
for(const id of ['import-top','import-empty'])$(id).addEventListener('click',()=>importFiles());
$('restore-backup').addEventListener('click',()=>importFiles(true));
$('search').addEventListener('input',renderBooks);
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>setTab(button.dataset.tab));

function setTab(tab) {
  activeTab=tab;
  for(const [name,id] of [['books','books-panel'],['notes','notes-panel'],['settings','settings-panel']])$(id).hidden=name!==tab;
  for(const button of document.querySelectorAll('[data-tab]')){if(button.dataset.tab===tab)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  if(tab==='notes')renderAnnotations($('all-notes'));
  if(tab==='settings')refreshStorage();
  window.scrollTo(0,0);
}

async function refresh() {
  papers=await all('papers');states=new Map((await all('states')).map(state=>[state.id,state]));
  papers.sort((a,b)=>(states.get(b.id)?.updatedAt||b.importedAt)-(states.get(a.id)?.updatedAt||a.importedAt));
  renderBooks();if(activeTab==='notes')renderAnnotations($('all-notes'));
}

function renderBooks() {
  const query=$('search').value.trim().toLocaleLowerCase(),filtered=papers.filter(paper=>paper.title.toLocaleLowerCase().includes(query));
  $('search-box').hidden=!papers.length;$('empty-library').hidden=!!papers.length;$('book-list').hidden=!papers.length;
  $('no-results').hidden=!papers.length||!!filtered.length;
  $('library-caption').textContent=papers.length?`${papers.length} 篇论文，留在这台设备。`:'把论文带在身边，安心读下去。';
  $('book-list').replaceChildren();
  for(const paper of filtered) {
    const state=states.get(paper.id),row=el('article',undefined,'book-row'),symbol=el('div',undefined,'paper-symbol');symbol.setAttribute('aria-hidden','true');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 28');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M5 2h10l5 5v19H5zM15 2v6h5M9 13h7M9 17h7M9 21h4');svg.append(path);symbol.append(svg);
    const open=el('button',undefined,'book-open');open.type='button';open.append(el('span',paper.title,'book-title'),el('span',`第 ${state?.page||1} / ${paper.pages.length} 页 · ${readableBytes(paper.bytes)}`,'book-meta'));
    open.addEventListener('click',()=>openPaper(paper.id));
    const menu=el('button','⋯','book-menu');menu.type='button';menu.setAttribute('aria-label',`${paper.title} 的选项`);menu.addEventListener('click',()=>paperMenu(paper));row.append(symbol,open,menu);$('book-list').append(row);
  }
}

async function openPaper(id,page) {
  if(busy)return;
  try {await reader.open(id);if(page)reader.goToPage(page);history.pushState({reader:true},'','#read');}
  catch(error){toast(error.message);await reader.close();}
}
async function backToLibrary() {
  await reader.close();await refresh();
  if(location.hash==='#read')history.back();
}
window.addEventListener('popstate',()=>{if(reader.active&&location.hash!=='#read')backToLibrary();});
if(location.hash==='#read')history.replaceState(null,'',location.pathname+location.search);

function paperMenu(paper) {
  const body=document.createDocumentFragment();body.append(el('p',`${paper.pages.length} 页 · ${readableBytes(paper.bytes)} · ${date(paper.importedAt)} 导入`,'muted'));
  const actions=el('div',undefined,'settings-actions'),backup=el('button','备份这篇论文','primary'),notes=el('button','查看高亮和批注'),remove=el('button','删除论文','danger');
  backup.type=notes.type=remove.type='button';backup.onclick=()=>exportBackup([paper.id]);notes.onclick=()=>showPaperNotes(paper.id);
  remove.onclick=async()=>{if(!await confirmDelete('删除这篇论文？','本机的论文、阅读进度、高亮和批注都会删除。请先确认已有备份。'))return;try{await removePaper(paper.id);closeDialog();await refresh();toast('已从本机书架删除');}catch{toast('删除失败，请重新打开书架后重试。');}};
  actions.append(backup,notes,remove);body.append(actions);showDialog(paper.title,body);
}

function annotations(paperId) {
  const results=[];
  for(const paper of papers.filter(item=>!paperId||item.id===paperId)) {
    const state=reader.active&&reader.paper.id===paper.id?reader.state:states.get(paper.id);if(!state)continue;
    const words=paper.pages.flatMap(page=>page.words);let offset=0;const starts=paper.pages.map(page=>{const start=offset;offset+=page.words.length;return start;});
    function pageAt(index){let page=1;for(let p=0;p<starts.length;p++){if(starts[p]<=index)page=p+1;else break;}return page;}
    for(const note of state.notes)results.push({...note,type:'note',paperId:paper.id,title:paper.title});
    let previous=null;
    for(const [key,color] of Object.entries(state.marks).sort((a,b)=>Number(a[0])-Number(b[0]))) {
      const index=Number(key),page=pageAt(index);
      if(previous&&previous.end===index&&previous.color===color&&previous.page===page)previous.end=index+1;
      else{previous={type:'highlight',paperId:paper.id,title:paper.title,start:index,end:index+1,color,page};results.push(previous);}
    }
    for(const result of results.filter(item=>item.paperId===paper.id&&item.type==='highlight'))result.quote=words.slice(result.start,result.end).map(word=>word.text).join(' ');
  }
  return results.sort((a,b)=>a.paperId.localeCompare(b.paperId)||a.start-b.start);
}

function renderAnnotations(container,paperId) {
  container.replaceChildren();const entries=annotations(paperId);
  if(!entries.length){container.append(el('p','还没有标注。阅读时选中文字，就能高亮或写批注。','annotation-empty'));return;}
  for(const entry of entries) {
    const row=el('article',undefined,'annotation-row'),heading=el('div',undefined,'annotation-heading');
    if(entry.color){const dot=el('span',undefined,'color-dot');dot.style.background=`var(--${entry.color})`;heading.append(dot);}
    heading.append(el('span',`${entry.type==='note'?'批注':'高亮'} · 第 ${entry.page} 页`));
    row.append(heading);if(!paperId)row.append(el('p',entry.title,'annotation-title'));row.append(el('blockquote',entry.quote));if(entry.text)row.append(el('p',entry.text));
    const actions=el('div',undefined,'row-actions'),locate=el('button','回到原文','note-link');locate.type='button';locate.onclick=async()=>{closeDialog();if(reader.active&&reader.paper.id===entry.paperId)reader.goToPage(entry.page);else await openPaper(entry.paperId,entry.page);};actions.append(locate);
    if(entry.type==='note') {
      const edit=el('button','编辑','note-link');edit.type='button';edit.onclick=async()=>{if(!reader.active||reader.paper.id!==entry.paperId){closeDialog();await openPaper(entry.paperId,entry.page);}reader.addNote(entry);};actions.append(edit);
    }
    const remove=el('button','删除','note-link');remove.type='button';remove.onclick=async()=>{
      if(!await confirmDelete('删除这条标注？','只删除当前设备上的这条标注。'))return;
      try {
        const live=reader.active&&reader.paper.id===entry.paperId,state=live?reader.state:await get('states',entry.paperId);
        if(entry.type==='note')state.notes=state.notes.filter(note=>note.id!==entry.id);
        else for(let index=entry.start;index<entry.end;index++)delete state.marks[index];
        state.updatedAt=Date.now();await put('states',state);
        if(live){reader.paintNotes();if(entry.type==='highlight')for(let index=entry.start;index<entry.end;index++)reader.words[index].classList.remove(`mark-${entry.color}`);}
        await refresh();renderAnnotations(container,paperId);toast('标注已删除');
      }catch{toast('删除失败，请重试。');}
    };actions.append(remove);row.append(actions);container.append(row);
  }
}
async function showPaperNotes(id) {if(reader.active)await reader.flush();await refresh();const body=el('div');renderAnnotations(body,id);showDialog('高亮与批注',body);}

$('import-input').addEventListener('change',async event=>{
  const files=[...event.target.files];if(!files.length||busy)return;
  const replace=restoreMode;
  if(replace&&papers.length&&!await confirmDelete('从备份恢复？','备份中的进度和批注会替换本机的相同论文。其他论文不受影响。','确认恢复'))return;
  busy=true;$('import-progress').hidden=false;$('import-top').disabled=true;let imported=0,skipped=0;
  try {
    for(const file of files){const result=await importArchive(file,message=>$('import-message').textContent=message,replace);imported+=result.imported;skipped+=result.skipped;}
    toast(imported?`已导入 ${imported} 篇论文${skipped?`，跳过 ${skipped} 篇已有论文`:''}`:'这些论文已在书架中，原有标注已保留。');
    navigator.storage?.persist?.().catch(()=>{});setTab('books');
  }catch(error){showDialog('导入未完成',el('p',error.name==='QuotaExceededError'?'设备存储空间不足。请先导出备份，再清理空间后重试。':error.message||'请确认 ZIP 完整后重试。'));}
  finally{busy=false;$('import-progress').hidden=true;$('import-top').disabled=false;event.target.value='';await refresh();}
});

async function exportBackup(ids) {
  if(busy)return;busy=true;$('import-message').textContent='正在准备本地备份…';$('import-progress').hidden=false;
  try {
    if(reader.active)await reader.flush();
    const blob=await backupLibrary(ids),filename=`paper-shelf-backup-${new Date().toISOString().slice(0,10)}.zip`,url=URL.createObjectURL(blob),body=document.createDocumentFragment();
    body.append(el('p',`备份已准备好（${readableBytes(blob.size)}），包含论文、进度、高亮和批注。请保存到“文件”或你信任的位置。`));
    const actions=el('div',undefined,'settings-actions'),link=el('a','下载备份 ZIP');link.href=url;link.download=filename;link.className='download-link';actions.append(link);
    const file=new File([blob],filename,{type:'application/zip'});
    if(navigator.canShare?.({files:[file]})){
      const share=el('button','分享 / 存储到文件','primary');share.type='button';share.onclick=async()=>{try{await navigator.share({files:[file]});await put('settings',{id:'lastBackup',value:Date.now()});updateBackupStatus();}catch(error){if(error.name!=='AbortError')toast('请使用“下载备份 ZIP”保存。');}};actions.prepend(share);
    }
    link.onclick=async()=>{await put('settings',{id:'lastBackup',value:Date.now()});updateBackupStatus();};
    body.append(actions,el('p','请确认文件确实保存成功，再删除本机数据。','muted'));
    showDialog('保存完整备份',body,()=>setTimeout(()=>URL.revokeObjectURL(url),120000));
  }catch(error){toast(error.message||'无法导出，请重试。');}
  finally{busy=false;$('import-progress').hidden=true;}
}
$('backup-all').addEventListener('click',()=>exportBackup());
async function updateBackupStatus(){const record=await get('settings','lastBackup');$('backup-status').textContent=record?`上次发起备份保存：${date(record.value)}。请确认文件已保存成功。`:'尚未在此设备导出备份。';}

async function refreshStorage() {
  try{const estimate=await navigator.storage?.estimate?.(),persistent=await navigator.storage?.persisted?.();$('storage-status').textContent=`书架文件约 ${readableBytes(papers.reduce((sum,paper)=>sum+paper.bytes,0))}${estimate?`；此网站共占用 ${readableBytes(estimate.usage||0)}`:''}。${persistent?'系统已授予持久保存。':'系统尚未授予持久保存。'}`;}catch{$('storage-status').textContent='本地存储可用，系统未提供空间详情。';}
}
$('request-persistence').addEventListener('click',async()=>{try{toast(await navigator.storage?.persist?.()?'系统已授予持久保存。':'系统暂未授予。添加到主屏幕并定期备份。');await refreshStorage();}catch{toast('此浏览器暂不支持申请，请定期导出备份。');}});
$('delete-all').addEventListener('click',async()=>{if(!papers.length){toast('书架已经是空的。');return;}if(!await confirmDelete('清空本机书架？','所有论文、阅读进度、高亮和批注都会从这台设备删除。请先导出完整备份。'))return;try{await clearLibrary();await refresh();await refreshStorage();toast('本机书架已清空');}catch{toast('无法清空，请重试。');}});

let serviceWorker;
async function setupOffline() {
  if(!('serviceWorker' in navigator)){$('offline-status').textContent='当前浏览器不支持离线阅读器。请使用 Safari 并通过 HTTPS 打开。';return;}
  try {
    serviceWorker=await navigator.serviceWorker.register('./sw.js');
    const ready=await navigator.serviceWorker.ready;
    $('offline-status').textContent='阅读器离线文件已准备好。已导入的论文可在断网时阅读。';
    ready.addEventListener('updatefound',()=>{const worker=ready.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)toast('阅读器有新版本，可在设置中更新。');});});
  }catch{$('offline-status').textContent='离线文件尚未准备好。请保持联网，稍后重新打开网站。';}
}
$('check-update').addEventListener('click',async()=>{
  if(!serviceWorker){toast('请联网后重新打开网站。');return;}
  try{await serviceWorker.update();if(serviceWorker.waiting){if(reader.active)await reader.flush();serviceWorker.waiting.postMessage('activate-update');navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});}else toast('当前已经是最新版本。');}catch{toast('无法检查更新，请确认网络连接。');}
});

try{await db();await refresh();await updateBackupStatus();setupOffline();}
catch{$('empty-library').hidden=true;$('book-list').replaceChildren(el('p','无法打开本地存储。请使用 Safari 的普通浏览模式，并允许网站保存数据。','empty-message'));$('import-top').disabled=true;}
