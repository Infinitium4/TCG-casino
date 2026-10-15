(() => {
  let socket=null,ready=false;
  function getSocket(){
    if(!socket&&typeof window.io==='function'){
      socket=window.io();
      socket.on('session:ready',()=>{ready=true;});
      socket.on('disconnect',()=>{ready=false;});
    }
    return socket;
  }
  function onReady(callback){
    const connection=getSocket();if(!connection)return ()=>{};
    connection.on('session:ready',callback);if(ready)callback();
    return ()=>connection.off('session:ready',callback);
  }
  window.casinoRealtime={getSocket,onReady};
})();
