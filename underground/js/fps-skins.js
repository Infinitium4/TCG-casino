(function(root){
  const skins = [
    {id:'classic',name:'Underground',edition:'STANDARD',price:0,color:'#8c3024',accent:'#e8bd64',body:[.55,.18,.13],trim:[.91,.74,.39],style:'vanguard'},
    {id:'ivory',name:'Ivory Club',edition:'COLLECTION PRIVÉE',price:1800,color:'#e0d8c5',accent:'#b88a48',body:[.82,.78,.68],trim:[.72,.54,.28],style:'sentinel'},
    {id:'emerald',name:'Emerald Fortune',edition:'COLLECTION PRIVÉE',price:2000,color:'#237c62',accent:'#e8c780',body:[.13,.48,.38],trim:[.91,.78,.50],style:'ranger'},
    {id:'royal',name:'Royal Flush',edition:'PRESTIGE',price:2200,color:'#7955aa',accent:'#e8c780',body:[.47,.33,.67],trim:[.91,.78,.50],style:'phantom'},
    {id:'gold',name:'Golden Ace',edition:'PRESTIGE',price:2500,color:'#c5a15a',accent:'#fff0bb',body:[.77,.63,.35],trim:[1,.94,.73],style:'ace'},
    {id:'smile',name:'Elouan',edition:'PORTRAIT / SIGNATURE',price:2000,color:'#343840',accent:'#e9c982',body:[.13,.15,.18],trim:[.91,.79,.51],style:'portrait'},
    {id:'titan',name:'Corentin',edition:'PORTRAIT / SIGNATURE',price:2400,color:'#b87954',accent:'#e9bd79',body:[.68,.43,.29],trim:[.91,.74,.47],style:'athlete'},
    {id:'striker',name:'Keenan',edition:'PORTRAIT / SIGNATURE',price:2100,color:'#202127',accent:'#eed147',body:[.07,.075,.085],trim:[.93,.82,.28],style:'sport'}
  ];
  if(typeof module!=='undefined'&&module.exports)module.exports=skins;
  else root.FpsSkins=skins;
})(globalThis);
