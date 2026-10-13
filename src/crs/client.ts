namespace crsModule {
  type FactionId = 'crs' | 'manifestants';
  interface FactionInfo { name: string; description: string; specialty: string; headquarters: string[] }
  interface GameState {
    phase: number;
    factions: Record<FactionId, FactionInfo>;
    account: { username: string; chips: number };
    player: { faction: FactionId; supplies: number; rating: number; created_at: string } | null;
    citadel: { headquarters_level: number; grid_width: number; grid_height: number } | null;
    buildings: { kind: string; level: number; x: number; y: number }[];
  }
  let data: GameState | null = null;
  let selection: FactionId | null = null;
  let pending = false;
  let initialized = false;
  let availabilityTimer: number | null = null;
  const node = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const number = (value: number): string => value.toLocaleString('fr-FR');
  const assetRoot = '/games/crs-vs-manifestants/assets/';
  function sprite(file: string, sheetWidth: number, x: number, y: number, width: number, height: number, label: string): HTMLElement {
    const frame = document.createElement('span');
    frame.className = 'crs-sprite';
    frame.style.aspectRatio = `${width} / ${height}`;
    frame.setAttribute('role', 'img'); frame.setAttribute('aria-label', label);
    const image = document.createElement('img');
    image.src = assetRoot + file; image.alt = ''; image.loading = 'lazy'; image.draggable = false;
    image.style.width = `${sheetWidth / width * 100}%`;
    image.style.left = `${-x / width * 100}%`; image.style.top = `${-y / height * 100}%`;
    frame.append(image); return frame;
  }
  function building(faction: FactionId, level: number, label: string): HTMLElement {
    const width = faction === 'crs' ? 756 : 763;
    const index = Math.max(0, Math.min(9, level - 1));
    return sprite(`buildings/${faction}/evolutions.png`, width, 6 + (index % 5) * (width / 5), index < 5 ? 26 : 188, 140, 128, label);
  }
  function renderArtwork(faction: FactionId, info: FactionInfo, level: number): void {
    node('crsHeadquartersArt').replaceChildren(building(faction, level, info.headquarters[level - 1]));
    const map = node('crsCitadelScene');
    map.dataset.faction = faction;
    const headquarters = node('crsMapHeadquarters');
    const position = data?.buildings.find(entry => entry.kind === 'headquarters');
    headquarters.style.left = `${((position?.x ?? 5) + .5) / (data?.citadel?.grid_width || 12) * 100}%`;
    headquarters.style.top = `${((position?.y ?? 5) + .5) / (data?.citadel?.grid_height || 12) * 100}%`;
    headquarters.replaceChildren(building(faction, level, info.headquarters[level - 1]));
    headquarters.setAttribute('aria-label', `Inspecter ${info.headquarters[level - 1]}`);
    const names = faction === 'crs' ? ['Police municipale', 'Police nationale', 'CRS', 'Gendarmerie', 'Unités d’élite'] : ['Lycéens', 'Étudiants', 'Militants', 'Hacktivistes', 'Élite'];
    const width = faction === 'crs' ? 557 : 627;
    node('crsUnitGallery').replaceChildren(...names.map((name, index) => {
      const card = document.createElement('div'); card.className = 'crs-unit-preview';
      card.append(sprite(`units/${faction}/planche.png`, width, 8 + index * ((width - 16) / 5), 25, (width - 16) / 5, 126, name));
      const title = document.createElement('strong'); title.textContent = name;
      card.append(title); return card;
    }));
  }

  async function request(method: string, body?: object): Promise<GameState> {
    const response = await fetch(method === 'GET' ? '/api/crs/state' : '/api/crs/faction', {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    if (response.status === 401) { window.location.assign('/'); throw new Error('Reconnecte-toi pour accéder au jeu.'); }
    if (response.status === 404) throw new Error('Redémarre le serveur pour charger la rubrique CRS VS Manifestants.');
    const payload = await response.json();
    if (response.status === 503) {
      data = null; selection = null;
      node('crsFactionChoice').hidden = true; node('crsDashboard').hidden = true;
      node('crsSelectionConfirm').hidden = true;
    }
    if (!response.ok) throw new Error(payload.error || 'Impossible de charger ta faction.');
    return payload as GameState;
  }
  function busy(value: boolean): void {
    pending = value;
    node<HTMLButtonElement>('crsRefresh').disabled = value;
    document.querySelectorAll<HTMLButtonElement>('[data-crs-faction]').forEach(button => { button.disabled = value; });
    node<HTMLButtonElement>('crsConfirmFaction').disabled = value || !selection;
    node('crsContent').setAttribute('aria-busy', String(value));
  }
  function render(): void {
    if (!data) return;
    node('crsError').textContent = '';
    node('crsLoading').hidden = true;
    node('crsFactionChoice').hidden = !!data.player;
    node('crsDashboard').hidden = !data.player;
    node('crsCasinoBalance').textContent = `${number(data.account.chips)} jetons`;
    if (!data.player || !data.citadel) return;
    selection = null;
    node('crsSelectionConfirm').hidden = true;
    const faction = data.factions[data.player.faction];
    renderArtwork(data.player.faction, faction, data.citadel.headquarters_level);
    node('crsDashboard').dataset.faction = data.player.faction;
    node('crsFactionName').textContent = faction.name;
    node('crsCommander').textContent = data.account.username;
    node('crsHeadquartersName').textContent = faction.headquarters[data.citadel.headquarters_level - 1];
    node('crsHeadquartersLevel').textContent = `${data.citadel.headquarters_level} / 10`;
    node('crsSupplies').textContent = number(data.player.supplies);
    node('crsRating').textContent = number(data.player.rating);
    node('crsSpecialty').textContent = faction.specialty;
    node('crsGridSize').textContent = `${data.citadel.grid_width} × ${data.citadel.grid_height}`;
    node('crsBuildingPosition').textContent = data.buildings[0] ? `QG sauvegardé en (${data.buildings[0].x}, ${data.buildings[0].y})` : 'Aucun QG';
    node('crsCreatedAt').textContent = new Date(`${data.player.created_at.replace(' ', 'T')}Z`).toLocaleDateString('fr-FR');
    const progression = node('crsProgression');
    progression.replaceChildren(...faction.headquarters.map((name, index) => {
      const item = document.createElement('li');
      item.append(building(data!.player!.faction, index + 1, name));
      const caption = document.createElement('span'); caption.textContent = `${index + 1}. ${name}`;
      const status = document.createElement('small'); status.textContent = index + 1 === data!.citadel!.headquarters_level ? 'QG actuel' : 'Évolution future';
      item.append(caption, status);
      if (index + 1 === data!.citadel!.headquarters_level) {
        item.className = 'is-current'; item.setAttribute('aria-current', 'step');
      }
      return item;
    }));
  }
  async function refresh(): Promise<void> {
    if (pending) return;
    busy(true);
    node('crsError').textContent = '';
    try { data = await request('GET'); render(); }
    catch (error) {
      data = null; selection = null;
      node('crsFactionChoice').hidden = true; node('crsDashboard').hidden = true;
      node('crsSelectionConfirm').hidden = true;
      node('crsLoading').hidden = true;
      node('crsError').textContent = error instanceof Error ? error.message : 'Chargement impossible.';
    }
    finally { busy(false); }
  }
  export function initialize(): void {
    if (initialized) return;
    initialized = true;
    for (const faction of ['crs', 'manifestants'] as const) {
      node(`crsChoiceArt-${faction}`).replaceChildren(building(faction, 1, faction === 'crs' ? 'Poste de police municipale' : 'Lycée révolté'));
    }
    node('crsSuppliesIcon').replaceChildren(sprite('ui/icones.png', 238, 1, 10, 39, 39, 'Provisions'));
    node('crsLevelIcon').replaceChildren(sprite('ui/icones.png', 238, 44, 10, 40, 39, 'Bâtiments'));
    node('crsRatingIcon').replaceChildren(sprite('ui/icones.png', 238, 138, 10, 40, 39, 'Progression'));
    node<HTMLInputElement>('crsMapZoom').addEventListener('input', event => {
      const zoom = Number((event.target as HTMLInputElement).value);
      node('crsCitadelScene').style.transform = `scale(${zoom / 100})`;
      node('crsZoomValue').textContent = `${zoom}%`;
    });
    node('crsGridToggle').addEventListener('click', event => {
      const button = event.currentTarget as HTMLButtonElement;
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(enabled)); node('crsCitadelScene').classList.toggle('show-grid', enabled);
    });
    node('crsMapHeadquarters').addEventListener('click', () => {
      node('crsHeadquartersDetails').hidden = !node('crsHeadquartersDetails').hidden;
      node('crsMapHeadquarters').setAttribute('aria-expanded', String(!node('crsHeadquartersDetails').hidden));
    });
    node('crsRefresh').addEventListener('click', refresh);
    document.querySelectorAll<HTMLButtonElement>('[data-crs-faction]').forEach(button => {
      button.addEventListener('click', () => {
        if (pending || data?.player || !data) return;
        selection = button.dataset.crsFaction as FactionId;
        document.querySelectorAll<HTMLButtonElement>('[data-crs-faction]').forEach(choice => {
          choice.setAttribute('aria-pressed', String(choice === button));
        });
        node('crsSelectedFaction').textContent = data.factions[selection].name;
        node('crsSelectionConfirm').hidden = false;
        busy(false);
      });
    });
    node('crsConfirmFaction').addEventListener('click', async () => {
      if (pending || !selection) return;
      busy(true);
      node('crsError').textContent = '';
      try { data = await request('POST', { faction: selection }); render(); }
      catch (error) {
        node('crsError').textContent = error instanceof Error ? error.message : 'Choix impossible.';
        // Another tab may have confirmed first. Reload the authoritative faction.
        try { const latest = await request('GET'); if (latest.player) { data = latest; render(); } } catch { /* Keep the original error visible. */ }
      }
      finally { busy(false); }
    });
  }
  export function setActive(active: boolean): void {
    if (availabilityTimer !== null) { window.clearInterval(availabilityTimer); availabilityTimer = null; }
    if (active) {
      void refresh();
      availabilityTimer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    }
  }
}
