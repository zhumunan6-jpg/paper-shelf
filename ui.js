export const $=id=>document.getElementById(id);
export function el(tag,value,className) {const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(className)node.className=className;return node;}
let toastTimer,dialogCleanup;
export function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
export function showDialog(title,body,cleanup) {
  const dialog=$('content-dialog');
  dialogCleanup?.();dialogCleanup=cleanup;
  $('dialog-title').textContent=title;$('dialog-body').replaceChildren(...(Array.isArray(body)?body:[body]));
  if(!dialog.open)dialog.showModal();
  $('dialog-body').scrollTop=0;dialog.scrollTop=0;
}
export const closeDialog=()=>$('content-dialog').close();
$('close-dialog').addEventListener('click',closeDialog);
$('content-dialog').addEventListener('close',()=>{dialogCleanup?.();dialogCleanup=null;});
$('content-dialog').addEventListener('click',event=>{if(event.target===$('content-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();}});
export function confirmDelete(title,message,acceptLabel='确认删除') {
  return new Promise(resolve=>{
    const dialog=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-text').textContent=message;$('confirm-accept').textContent=acceptLabel;
    let accepted=false;
    $('confirm-accept').onclick=()=>{accepted=true;dialog.close();};
    $('confirm-cancel').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>resolve(accepted),{once:true});dialog.showModal();$('confirm-cancel').focus();
  });
}
export function readableBytes(bytes){return bytes<1024*1024?`${Math.ceil(bytes/1024)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;}
