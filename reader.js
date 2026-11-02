import {get,put,defaultState} from './store.js';
import {$,el,toast,showDialog,closeDialog} from './ui.js';

export class Reader {
  constructor({onBack,onBackup,onShowNotes}) {
    this.active=false;this.urls=[];this.words=[];this.bounds=null;this.pointStart=null;this.saveQueue=Promise.resolve();
    $('back-library').addEventListener('click',()=>onBack());
    $('reader-options').addEventListener('click',()=>$('reader-controls').hidden=!$('reader-controls').hidden);
    $('zoom').addEventListener('change',()=>{this.capturePosition();this.state.zoom=$('zoom').value;this.resize();this.restorePosition();this.scheduleSave();});
    $('show-terms').addEventListener('change',()=>{this.state.showTerms=$('show-terms').checked;$('pages').classList.toggle('show-terms',this.state.showTerms);this.scheduleSave();});
    $('page-number').addEventListener('change',()=>this.goToPage(Number($('page-number').value)));
    $('previous-page').addEventListener('click',()=>this.goToPage(this.state.page-1));
    $('next-page').addEventListener('click',()=>this.goToPage(this.state.page+1));
    $('reader-scroll').addEventListener('scroll',()=>{if(!this.active||this.restoring)return;this.capturePosition();this.scheduleSave();},{passive:true});
    window.addEventListener('resize',()=>{if(!this.active)return;this.capturePosition();this.resize();this.restorePosition();});
    document.addEventListener('selectionchange',()=>{clearTimeout(this.selectionTimer);if(this.active&&!this.pointMode&&!$('content-dialog').open)this.selectionTimer=setTimeout(()=>this.nativeSelection(),120);});
    $('pages').addEventListener('contextmenu',event=>{if(this.active&&this.readNativeBounds()){event.preventDefault();this.nativeSelection();}});
    $('pages').addEventListener('click',event=>this.onWordClick(event));
    $('selection-mode').addEventListener('click',()=>{this.pointMode=!this.pointMode;$('selection-mode').setAttribute('aria-pressed',String(this.pointMode));$('pages').classList.toggle('point-mode',this.pointMode);this.clearSelection();toast(this.pointMode?'点起始词，再点结束词；点一个词也可查译。':'长按文字拖动选区，即可查译和高亮。');});
    $('selection-tools').addEventListener('pointerdown',event=>event.preventDefault());
    $('selection-tools').addEventListener('click',event=>{const button=event.target.closest('[data-color]');if(button)this.highlight(button.dataset.color);});
    $('translate-selection').addEventListener('click',()=>this.translate());
    $('add-note').addEventListener('click',()=>this.addNote());
    $('clear-selection').addEventListener('click',()=>this.clearSelection());
    $('open-original').addEventListener('click',()=>this.openOriginal().catch(error=>toast(error.message)));
    $('backup-paper').addEventListener('click',()=>onBackup([this.paper.id]));
    $('show-paper-notes').addEventListener('click',()=>onShowNotes(this.paper.id));
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&this.active)this.flush();});
    window.addEventListener('pagehide',()=>{if(this.active)this.flush();});
  }

  async open(id) {
    const paper=await get('papers',id);
    if(!paper)throw new Error('没有找到这篇论文，请重新导入。');
    await this.close();
    this.paper=paper;this.state=(await get('states',id))||defaultState(id);this.lookup=window.createPaperLookup(paper);this.words=[];this.pointMode=false;this.active=true;
    $('library-view').hidden=true;$('reader-view').hidden=false;$('reader-title').textContent=paper.title;
    $('reader-controls').hidden=true;$('zoom').value=this.state.zoom;$('show-terms').checked=this.state.showTerms;
    $('selection-mode').setAttribute('aria-pressed','false');$('pages').classList.remove('point-mode');$('pages').classList.toggle('show-terms',this.state.showTerms);
    $('page-count').textContent=`/ ${paper.pages.length}`;$('page-number').max=paper.pages.length;
    const termAt=new Map();
    for(const term of this.lookup.terms)for(const index of term.indices)if(!termAt.has(index))termAt.set(index,term);
    this.termAt=termAt;
    const fragment=document.createDocumentFragment();
    for(const page of paper.pages) {
      const article=el('section',undefined,'paper-page');article.dataset.page=page.number;article.setAttribute('aria-label',`第 ${page.number} 页`);
      const asset=await get('assets',`${id}/${page.image}`);
      if(!asset){await this.close();throw new Error('论文页面文件缺失，请从备份重新导入。');}
      const image=el('img',undefined,'page-image');const url=URL.createObjectURL(asset.blob);this.urls.push(url);image.src=url;image.alt='';image.draggable=false;image.loading=page.number<3?'eager':'lazy';
      const layer=el('div',undefined,'text-layer');
      for(const [i,word] of page.words.entries()) {
        const index=this.lookup.offsets[page.number-1]+i,node=el('span',word.text,'word');
        node.dataset.index=index;const [x0,y0,x1,y1]=word.rect;
        node.style.left=`${x0/page.width*100}%`;node.style.top=`${y0/page.height*100}%`;node.style.height=`${(y1-y0)/page.height*100}%`;
        if(termAt.has(index))node.classList.add('term');
        if(this.state.marks[index])node.classList.add(`mark-${this.state.marks[index]}`);
        layer.append(node);this.words.push(node);
      }
      article.append(image,layer);fragment.append(article);
    }
    $('pages').replaceChildren(fragment);this.paintNotes();this.resize();
    await new Promise(requestAnimationFrame);this.restorePosition();this.state.updatedAt=Date.now();await this.flush(false);
    document.title='论文书架';
    toast('长按划词查译；不好选时，可开启“点选查译”。');
  }

  resize() {
    const context=document.createElement('canvas').getContext('2d'),available=$('reader-scroll').clientWidth-24;
    for(const [p,page] of this.paper.pages.entries()) {
      const scale=this.state.zoom==='fit'?Math.min(1.65,available/page.width):Number(this.state.zoom);
      const article=$('pages').children[p];if(!article)continue;
      article.style.width=`${page.width*scale}px`;article.style.height=`${page.height*scale}px`;
      page.words.forEach((word,i)=>{const node=this.words[this.lookup.offsets[p]+i],height=(word.rect[3]-word.rect[1])*scale,width=(word.rect[2]-word.rect[0])*scale;node.style.fontSize=`${height}px`;context.font=`${height}px "Times New Roman"`;const measured=Math.max(1,context.measureText(word.text).width);node.style.width=`${measured}px`;node.style.transform=`scaleX(${width/measured})`;});
    }
  }

  capturePosition() {
    if(!this.active)return;
    const scroll=$('reader-scroll');let current=$('pages').firstElementChild;
    for(const node of $('pages').children){if(node.offsetTop<=scroll.scrollTop+30)current=node;else break;}
    if(!current)return;
    this.state.page=Number(current.dataset.page);this.state.fraction=Math.max(0,Math.min(1,(scroll.scrollTop-current.offsetTop)/current.offsetHeight));this.updatePageControl();
  }
  updatePageControl() {$('page-number').value=this.state.page;$('previous-page').disabled=this.state.page<=1;$('next-page').disabled=this.state.page>=this.paper.pages.length;}
  restorePosition() {
    this.restoring=true;const node=$('pages').children[this.state.page-1];
    if(node)$('reader-scroll').scrollTop=Math.max(0,node.offsetTop+node.offsetHeight*this.state.fraction);
    this.updatePageControl();requestAnimationFrame(()=>{this.restoring=false;});
  }
  goToPage(page) {if(!this.active)return;this.state.page=Math.max(1,Math.min(this.paper.pages.length,Math.round(page)||1));this.state.fraction=0;this.restorePosition();this.scheduleSave();}
  scheduleSave() {$('reader-save-status').textContent='正在保存…';clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.flush(false),350);}
  async flush(capture=true) {
    clearTimeout(this.saveTimer);if(!this.active)return;
    if(capture&&!this.restoring)this.capturePosition();
    this.state.updatedAt=Date.now();const snapshot=structuredClone(this.state);
    this.saveQueue=this.saveQueue.catch(()=>{}).then(()=>put('states',snapshot));
    try{await this.saveQueue;if(this.active)$('reader-save-status').textContent='已保存在本机';}
    catch{$('reader-save-status').textContent='保存失败，请导出备份';toast('本地保存失败，可能空间不足。请及时导出备份。');}
  }
  async close() {
    if(this.active)await this.flush();this.active=false;clearTimeout(this.saveTimer);clearTimeout(this.selectionTimer);this.clearSelection();
    for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];this.words=[];$('pages').replaceChildren();$('reader-view').hidden=true;$('library-view').hidden=false;
  }

  readNativeBounds() {
    const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed)return null;
    const range=selection.getRangeAt(0),nodes=this.words.filter(node=>range.intersectsNode(node));
    if(!nodes.length)return null;
    return {start:Number(nodes[0].dataset.index),end:Number(nodes.at(-1).dataset.index)+1};
  }
  nativeSelection() {
    const bounds=this.readNativeBounds();if(bounds){this.bounds=bounds;$('selection-tools').hidden=false;}else if(!$('content-dialog').open){this.bounds=null;$('selection-tools').hidden=true;}
  }
  clearSelection() {this.bounds=null;this.pointStart=null;getSelection()?.removeAllRanges();this.words.forEach(node=>node.classList.remove('point-selected'));$('selection-tools').hidden=true;}
  onWordClick(event) {
    const word=event.target.closest('.word');if(!word||!this.active)return;
    const index=Number(word.dataset.index);
    if(this.pointMode){
      if(this.pointStart===null){this.pointStart=index;this.bounds={start:index,end:index+1};}
      else{this.bounds={start:Math.min(index,this.pointStart),end:Math.max(index,this.pointStart)+1};this.pointStart=null;}
      this.words.forEach((node,i)=>node.classList.toggle('point-selected',i>=this.bounds.start&&i<this.bounds.end));$('selection-tools').hidden=false;return;
    }
    if(this.readNativeBounds())return;
    const term=this.termAt.get(index);
    if(term&&this.state.showTerms){const body=document.createDocumentFragment();body.append(el('p',term.summary));for(const section of term.sections)body.append(el('h3',section.title),el('p',section.body));showDialog(term.source,body);}
  }
  translate() {
    if(!this.bounds)return;const result=this.lookup.translate(this.bounds.start,this.bounds.end),body=document.createDocumentFragment();
    body.append(el('p',result.source,'source'));
    const words=['word','words','phrase'].includes(result.mode);
    for(const entry of result.entries){if(words)body.append(el('h3',entry.source));body.append(el('p',entry.zh));}
    showDialog(words?'词语释义':'中文翻译',body);
  }
  highlight(color) {
    if(!this.bounds)return;
    for(let i=this.bounds.start;i<this.bounds.end;i++){if(color==='clear')delete this.state.marks[i];else this.state.marks[i]=color;for(const value of ['yellow','blue','green','red'])this.words[i].classList.toggle(`mark-${value}`,this.state.marks[i]===value);}
    this.scheduleSave();toast(color==='clear'?'已恢复原色':'高亮已保存在本机');this.clearSelection();
  }
  addNote(existing) {
    const bounds=existing?{start:existing.start,end:existing.end}:this.bounds;if(!bounds)return;
    const quote=this.words.slice(bounds.start,bounds.end).map(node=>node.textContent).join(' '),body=document.createDocumentFragment();body.append(el('p',quote,'source'));
    const label=el('label','写下你的批注');label.htmlFor='note-text';const input=el('textarea');input.id='note-text';input.maxLength=10000;input.placeholder='这段话让你想到什么？';input.value=existing?.text||'';
    const save=el('button','保存批注','primary');save.type='button';save.addEventListener('click',()=>{
      if(!input.value.trim()){input.focus();toast('请先写一点内容。');return;}
      const note={id:existing?.id||crypto.randomUUID(),...bounds,quote,text:input.value.trim(),page:Number(this.words[bounds.start].closest('.paper-page').dataset.page),createdAt:existing?.createdAt||Date.now()};
      this.state.notes=this.state.notes.filter(item=>item.id!==note.id);this.state.notes.push(note);this.paintNotes();this.scheduleSave();closeDialog();this.clearSelection();toast('批注已保存在本机');
    });const actions=el('div',undefined,'settings-actions');actions.append(save);body.append(label,input,actions);showDialog(existing?'编辑批注':'添加批注',body);
  }
  paintNotes() {const indices=new Set();for(const note of this.state.notes)for(let i=note.start;i<note.end;i++)indices.add(i);this.words.forEach((node,i)=>node.classList.toggle('has-note',indices.has(i)));}
  async openOriginal() {
    const asset=await get('assets',`${this.paper.id}/data/original.pdf`);if(!asset){toast('原 PDF 文件缺失，请重新导入。');return;}
    const url=URL.createObjectURL(asset.blob),body=document.createDocumentFragment();body.append(el('p','在新窗口打开本机保存的 PDF。'));
    const link=el('a','打开原始 PDF');link.href=url;link.target='_blank';link.rel='noopener noreferrer';body.append(link);
    showDialog('原始 PDF',body,()=>setTimeout(()=>URL.revokeObjectURL(url),60000));
  }
}
