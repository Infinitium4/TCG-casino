window.refreshFpsShop=async function(){
  const cards=document.getElementById('skinCards'),feedback=document.getElementById('shopFeedback');
  const money=value=>Number(value).toLocaleString('fr-FR',{maximumFractionDigits:2})+' \u20ac';
  async function request(url,body){
    const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Boutique indisponible.');return data;
  }
  function render(data){
    window.dispatchEvent(new CustomEvent('fps:shop-updated',{detail:data}));
    document.getElementById('shopBalance').textContent=money(data.balance);cards.replaceChildren();
    const locker=document.getElementById('lockerCards');locker.replaceChildren();
    for(const skin of data.skins.filter(s=>data.owned.includes(s.id))){
      const button=document.createElement('button');button.type='button';button.className='locker-item'+(data.equipped===skin.id?' selected':'');
      button.style.setProperty('--skin',skin.color);button.style.setProperty('--trim',skin.accent);
      const swatch=document.createElement('i'),name=document.createElement('strong'),status=document.createElement('small');name.textContent=skin.name;status.textContent=data.equipped===skin.id?'Équipé':'Équiper';
      const thumbnail=FpsRenderer.skinPreview(skin);
      if(thumbnail){const image=document.createElement('img');image.src=thumbnail;image.alt='';swatch.append(image);swatch.className='locker-portrait';}
      button.append(swatch,name,status);button.disabled=data.equipped===skin.id;
      button.addEventListener('click',async()=>{
        for(const b of locker.querySelectorAll('button'))b.disabled=true;
        const feedback=document.getElementById('lockerFeedback');feedback.textContent='';
        try{render(await request('/api/fps/shop/equip',{skinId:skin.id}));feedback.textContent='Skin équipé.';}
        catch(error){render(data);feedback.textContent=error.message;}
      });locker.append(button);
    }
    for(const skin of data.skins){
      const owned=data.owned.includes(skin.id),equipped=data.equipped===skin.id;
      const card=document.createElement('article');card.className='skin-card'+(equipped?' equipped':'');
      card.style.setProperty('--skin',skin.color);card.style.setProperty('--trim',skin.accent);
      const preview=document.createElement('div');preview.className='skin-preview';preview.setAttribute('aria-hidden','true');
      preview.innerHTML='<div class="skin-halo"></div><div class="skin-helmet"><i></i></div><div class="skin-armor"></div><div class="skin-rifle"><i></i></div>';
      const thumbnail=FpsRenderer.skinPreview(skin);
      if(thumbnail){const image=document.createElement('img');image.src=thumbnail;image.alt='';preview.replaceChildren(image);preview.classList.add('model-preview');}
      const edition=document.createElement('p');edition.className='eyebrow';edition.textContent=skin.edition;
      const name=document.createElement('h3');name.textContent=skin.name;
      const price=document.createElement('p');price.className='skin-price';price.textContent=owned?'Dans ton vestiaire':money(skin.price);
      const button=document.createElement('button');button.className=equipped?'secondary':'primary';button.type='button';
      button.textContent=equipped?'Équipé':owned?'Équiper':skin.price===0?'Débloquer gratuitement':data.balance<skin.price?'Solde insuffisant':'Acheter · '+money(skin.price);
      button.disabled=equipped||(!owned&&data.balance<skin.price);
      button.addEventListener('click',async()=>{
        for(const b of cards.querySelectorAll('button'))b.disabled=true;
        feedback.textContent='';
        try{render(await request('/api/fps/shop/'+(owned?'equip':'buy'),{skinId:skin.id}));feedback.textContent=owned?'Skin équipé. Retrouve-le dans le lobby et dans ton groupe.':'Skin acheté ! Il est disponible dans ton vestiaire.';}
        catch(error){feedback.textContent=error.message;try{render(await request('/api/fps/shop'));}catch{button.disabled=false;}}
      });
      card.append(preview,edition,name,price,button);cards.append(card);
    }
  }
  try{render(await request('/api/fps/shop'));}catch(error){feedback.textContent=error.message;}
};
