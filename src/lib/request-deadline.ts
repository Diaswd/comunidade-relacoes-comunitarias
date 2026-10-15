// Bound the whole operation, including a stalled session lookup before fetch.
export async function withDeadline<T>(operation:(signal:AbortSignal)=>PromiseLike<T>,options:{signal?:AbortSignal;timeoutMs:number;message:string}):Promise<T>{
 const controller=new AbortController();
 const cancel=()=>controller.abort(options.signal?.reason);
 options.signal?.addEventListener('abort',cancel,{once:true});
 if(options.signal?.aborted)cancel();
 const timer=setTimeout(()=>controller.abort(new Error(options.message)),options.timeoutMs);
 let onAbort:()=>void=()=>{};
 const interrupted=new Promise<never>((_resolve,reject)=>{
  onAbort=()=>reject(controller.signal.reason);
  controller.signal.addEventListener('abort',onAbort,{once:true});
  if(controller.signal.aborted)onAbort();
 });
 try{
  return await Promise.race([interrupted,Promise.resolve().then(()=>{controller.signal.throwIfAborted();return operation(controller.signal)})]);
 }finally{
  clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);
 }
}
