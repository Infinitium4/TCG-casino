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
  const node = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const number = (value: number): string => value.toLocaleString('fr-FR');

  async function request(method: string, body?: object): Promise<GameState> {
    const response = await fetch(method === 'GET' ? '/api/crs/state' : '/api/crs/faction', {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    if (response.status === 401) { window.location.assign('/'); throw new Error('Reconnecte-toi pour accéder au jeu.'); }
    if (response.status === 404) throw new Error('Redémarre le serveur pour charger la rubrique CRS VS Manifestants.');
    const payload = await response.json();
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
      item.textContent = `${index + 1}. ${name}`;
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
    catch (error) { node('crsLoading').hidden = true; node('crsError').textContent = error instanceof Error ? error.message : 'Chargement impossible.'; }
    finally { busy(false); }
  }
  export function initialize(): void {
    if (initialized) return;
    initialized = true;
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
  export function setActive(active: boolean): void { if (active) void refresh(); }
}
