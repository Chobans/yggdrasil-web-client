// Main app logic

function $(id){return document.getElementById(id)}

// Common state
const MS_PER_DAY = 24*3600*1000;
let viewportDays = 30;
let centerDate = new Date();
const MIN_DAYS = 1;
const MAX_DAYS = 365*200;
let events = []; // array of {id, date, name, color, description, tag, predecessorIds[], successorIds[]}
let viewStatusFilter = 'all'; // all | active | completed
let currentMode = 'timeline'; // 'timeline' or 'calendar'
let calendarMonth = new Date(); // current month for calendar view
let pendingEventId = null; // for calendar event editing
let eventModalMode = 'create';
const chart = $('chart');
const panLeftBtn = $('panLeftBtn');
const panRightBtn = $('panRightBtn');
const stepInput = $('stepInput');
const rangeLabel = $('rangeLabel');
const createEventDateInput = $('createEventDateInput');
const createEventInput = $('createEventInput');
const createEventColorInput = $('createEventColor');
const createEventDescInput = $('createEventDesc');
const createEventTagInput = $('createEventTag');
const createEventCompletedInput = $('createEventCompleted');
const predecessorsList = $('predecessorsList');
const successorsList = $('successorsList');
const eventModal = $('createEventModal');
const eventModalTitle = $('eventModalTitle');
const eventModalSaveBtn = $('eventModalSaveBtn');
const eventModalDeleteBtn = $('eventModalDeleteBtn');
const eventsSearchInput = $('eventsSearchInput');
const eventsList = $('eventsList');
const modeTimelineBtn = $('modeTimelineBtn');
const modeCalendarBtn = $('modeCalendarBtn');
const timelineControls = $('timelineControls');
const calendarControls = $('calendarControls');
const timelineChart = $('timelineChart');
const calendarChart = $('calendarChart');
const calendarGrid = $('calendarGrid');
const prevMonthBtn = $('prevMonthBtn');
const nextMonthBtn = $('nextMonthBtn');
const calendarMonthLabel = $('calendarMonthLabel');
const timelineStatusFilter = $('timelineStatusFilter');
const calendarStatusFilter = $('calendarStatusFilter');
const refreshDataBtn = $('refreshDataBtn');
const saveDataBtn = $('saveDataBtn');
const syncStatus = $('syncStatus');
const CALENDAR_API_URL = 'http://localhost:8090/calendar';
const API_REQUEST_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
let apiSaveQueue = Promise.resolve();
let nextEventId = 1;

function generateEventId(){
  const eventId = nextEventId;
  nextEventId += 1;
  return eventId;
}

function syncNextEventIdFromEvents(){
  const maxEventId = events.reduce((maxId, evt)=>{
    const eventId = Number(evt && evt.id);
    return Number.isFinite(eventId) && eventId > maxId ? eventId : maxId;
  }, 0);
  nextEventId = maxEventId + 1;
}

function normalizeIdList(value){
  if(!Array.isArray(value)) return [];
  return value
    .map(item => Number(item))
    .filter(Number.isFinite)
    .map(item => Math.trunc(item));
}

function getEventIndexById(eventId){
  const numericId = Number(eventId);
  if(!Number.isFinite(numericId)) return -1;
  return events.findIndex(event => Number(event.id) === numericId);
}

function getEventById(eventId){
  const eventIndex = getEventIndexById(eventId);
  return eventIndex === -1 ? null : events[eventIndex];
}

function updateSyncStatus(text){
  if(syncStatus) syncStatus.textContent = text;
}

function cloneEventForApi(evt){
  const eventId = Number.isFinite(evt.id) ? evt.id : generateEventId();
  if(!Number.isFinite(evt.id)) evt.id = eventId;
  return {
    id: eventId,
    date: evt.date instanceof Date ? evt.date.toISOString() : evt.date,
    name: evt.name || '',
    color: evt.color || '#ff6b6b',
    description: evt.description || '',
    tag: evt.tag || '',
    status: evt.status === 'completed' ? 'completed' : 'active',
    predecessorIds: normalizeIdList(evt.predecessorIds),
    successorIds: normalizeIdList(evt.successorIds),
    verticalOffset: Number.isFinite(evt.verticalOffset) ? evt.verticalOffset : 0
  };
}

function normalizeLoadedEvent(rawEvt){
  const numericId = Number(rawEvt && rawEvt.id);
  const date = new Date(rawEvt && rawEvt.date ? rawEvt.date : Date.now());
  if(isNaN(date)) return null;
  return {
    id: Number.isFinite(numericId) ? Math.trunc(numericId) : generateEventId(),
    date,
    name: String(rawEvt && rawEvt.name ? rawEvt.name : ''),
    color: rawEvt && rawEvt.color ? rawEvt.color : '#ff6b6b',
    description: rawEvt && rawEvt.description ? String(rawEvt.description) : '',
    tag: rawEvt && rawEvt.tag ? String(rawEvt.tag) : '',
    status: rawEvt && rawEvt.status === 'completed' ? 'completed' : 'active',
    predecessorIds: normalizeIdList(rawEvt && rawEvt.predecessorIds),
    successorIds: normalizeIdList(rawEvt && rawEvt.successorIds),
    verticalOffset: Number.isFinite(rawEvt && rawEvt.verticalOffset) ? rawEvt.verticalOffset : 0
  };
}

function normalizeLoadedEvents(rawPayload){
  const eventArray = Array.isArray(rawPayload) ? rawPayload : Array.isArray(rawPayload && rawPayload.events) ? rawPayload.events : null;
  if(!eventArray) throw new Error('JSON должен содержать массив events');
  return eventArray.map(normalizeLoadedEvent).filter(Boolean);
}

function buildApiPayload(){
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    events: events.map(cloneEventForApi)
  };
}

async function fetchEventsFromApi(){
  const response = await fetch(CALENDAR_API_URL, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  if(!response.ok){
    throw new Error(`Не удалось загрузить данные календаря: ${response.status}`);
  }
  const text = await response.text();
  if(!text.trim()) return [];
  return normalizeLoadedEvents(JSON.parse(text));
}

async function saveEventsToApi(){
  const formData = new FormData();
  const jsonData = JSON.stringify(buildApiPayload(), null, 2);
  const blob = new Blob([jsonData], { type: 'application/json' });
  formData.append('calendar_data', blob, 'calendar.json');
  
  try {
    updateSyncStatus('Синхронизация...');
    const response = await fetch(CALENDAR_API_URL, {
      method: 'POST',
      body: formData
    });
    
    const responseText = await response.text();
    if(!response.ok){
      console.error('Ошибка сохранения:', response.status, responseText);
      throw new Error(`Ошибка при сохранении (${response.status}): ${responseText}`);
    }
    
    console.log('Календарь успешно сохранён:', responseText);
    updateSyncStatus('Синхронизировано');
  } catch (error) {
    console.error('Ошибка синхронизации:', error);
    updateSyncStatus('Ошибка синхронизации');
    throw error;
  }
}

function queueDataFileSave(){
  apiSaveQueue = apiSaveQueue
    .then(()=>saveEventsToApi())
    .catch(error=>{
      console.warn('Не удалось синхронизировать календарь', error);
      updateSyncStatus('Не удалось синхронизировать изменения');
    });
  return apiSaveQueue;
}

function ensureEventDefaults(evt){
  if(!evt.status || (evt.status !== 'active' && evt.status !== 'completed')) evt.status = 'active';
  if(typeof evt.verticalOffset === 'undefined') evt.verticalOffset = 0;
}

function isEventVisibleByStatus(evt){
  ensureEventDefaults(evt);
  if(viewStatusFilter === 'all') return true;
  return evt.status === viewStatusFilter;
}

function getVisibleEventsForViews(){
  return events.filter(isEventVisibleByStatus);
}

function setStatusFilter(filterValue){
  const allowed = ['all', 'active', 'completed'];
  viewStatusFilter = allowed.includes(filterValue) ? filterValue : 'all';
  if(timelineStatusFilter) timelineStatusFilter.value = viewStatusFilter;
  if(calendarStatusFilter) calendarStatusFilter.value = viewStatusFilter;
  updateEventsList();
  if(typeof window.renderChart === 'function') window.renderChart();
  if(typeof window.renderCalendar === 'function') window.renderCalendar();
}

function setEventStatus(eventIdx, completed){
  if(!events[eventIdx]) return;
  events[eventIdx].status = completed ? 'completed' : 'active';
  updateEventsList();
  queueDataFileSave();
  if(currentMode === 'timeline'){
    if(typeof window.renderChart === 'function') window.renderChart();
  } else {
    if(typeof window.renderCalendar === 'function') window.renderCalendar();
  }
}

function formatDateForInput(date){
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth()+1).padStart(2,'0');
  const dd = String(date.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// Initialization
const today = new Date();
today.setUTCHours(0,0,0,0);
centerDate = new Date(today);
if(createEventDateInput) createEventDateInput.value = formatDateForInput(today);
if(createEventColorInput) createEventColorInput.value = '#ff6b6b';

// Mode toggle
modeTimelineBtn.addEventListener('click', ()=>setMode('timeline'));
modeCalendarBtn.addEventListener('click', ()=>setMode('calendar'));

// Calendar navigation
prevMonthBtn.addEventListener('click', ()=>{
  calendarMonth.setMonth(calendarMonth.getMonth()-1);
  renderCalendar();
});
nextMonthBtn.addEventListener('click', ()=>{
  calendarMonth.setMonth(calendarMonth.getMonth()+1);
  renderCalendar();
});

if(timelineStatusFilter) timelineStatusFilter.addEventListener('change', (e)=>setStatusFilter(e.target.value));
if(calendarStatusFilter) calendarStatusFilter.addEventListener('change', (e)=>setStatusFilter(e.target.value));
setStatusFilter('all');

if(refreshDataBtn) refreshDataBtn.addEventListener('click', ()=>initializeDataSource());
if(saveDataBtn) saveDataBtn.addEventListener('click', ()=>saveEventsToApi());

// Timeline navigation
panLeftBtn.addEventListener('click', ()=>shiftCenterBy(-Number(stepInput.value)));
panRightBtn.addEventListener('click', ()=>shiftCenterBy(Number(stepInput.value)));

// Wheel -> zoom in/out on timeline, focus under cursor
chart.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const rect = chart.getBoundingClientRect();
  const dims = getDims();
  const mouseX = e.clientX - rect.left;
  const f = Math.max(0, Math.min(1, (mouseX - dims.margin.left) / dims.innerW));

  const before = getVisibleRange();
  const dateAtCursorMs = before.start.getTime() + f * (before.end.getTime() - before.start.getTime());

  const factor = Math.exp(e.deltaY * 0.0015);
  viewportDays = Math.max(MIN_DAYS, Math.min(MAX_DAYS, viewportDays * factor));

  const newSpanMs = viewportDays * MS_PER_DAY;
  const newStartMs = dateAtCursorMs - f * newSpanMs;
  const newCenterMs = newStartMs + newSpanMs/2;
  centerDate = new Date(newCenterMs);
  renderChart();
});

// Drag panning on timeline
let dragging = false, dragStartX = 0, dragStartCenterMs = 0;
chart.addEventListener('pointerdown', (e)=>{
  dragging = true;
  dragStartX = e.clientX;
  dragStartCenterMs = centerDate.getTime();
  chart.setPointerCapture && chart.setPointerCapture(e.pointerId);
  chart.style.cursor = 'grabbing';
});
window.addEventListener('pointermove', (e)=>{
  if(!dragging) return;
  const dims = getDims();
  const dx = e.clientX - dragStartX;
  const deltaDays = -dx / dims.innerW * viewportDays;
  centerDate = new Date(dragStartCenterMs + deltaDays * MS_PER_DAY);
  renderChart();
});
window.addEventListener('pointerup', (e)=>{
  if(!dragging) return;
  dragging = false;
  try{ chart.releasePointerCapture && chart.releasePointerCapture(e.pointerId); }catch(e){}
  chart.style.cursor = 'default';
});

stepInput.addEventListener('change', ()=>{
  const val = parseInt(stepInput.value, 10);
  if(!isNaN(val) && val > 0) stepInput.value = val;
});

// Add event button in events panel
const addEventBtn = $('addEventBtn');
if(addEventBtn) addEventBtn.addEventListener('click', ()=>openCreateEventModal());

// Event management (use unified modal)
// openCreateBtn removed from UI — calendar cells open modal instead
if(createEventInput) createEventInput.addEventListener('keypress', (e)=>{ if(e.key === 'Enter') saveEventFromModal(); });
if(createEventDescInput) createEventDescInput.addEventListener('keypress', (e)=>{ if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEventFromModal(); });
if(eventsSearchInput) eventsSearchInput.addEventListener('input', updateEventsList);

function formatDateShort(date){
  const day = String(date.getDate()).padStart(2,'0');
  const month = String(date.getMonth()+1).padStart(2,'0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function normalizeSearchText(text){
  return String(text || '').toLowerCase().trim();
}

function removeEvent(idx){
  events.splice(idx, 1);
  updateEventsList();
  queueDataFileSave();
  if(currentMode === 'timeline'){
    renderChart();
  } else {
    renderCalendar();
  }
}

function removeEventById(eventId){
  const eventIndex = getEventIndexById(eventId);
  if(eventIndex === -1) return;
  removeEvent(eventIndex);
}

// Make removeEvent global for onclick handlers
window.removeEvent = removeEvent;

function updateEventsList(){
  eventsList.innerHTML = '';
  events.forEach(ensureEventDefaults);
  const searchTerm = normalizeSearchText(eventsSearchInput ? eventsSearchInput.value : '');
  const filteredEvents = events
    .map((evt, idx)=>({evt, idx}))
    .filter(({evt})=>{
      if(!isEventVisibleByStatus(evt)) return false;
      if(!searchTerm) return true;
      const dateIso = evt.date.toISOString().slice(0,10);
      const dateShort = formatDateShort(evt.date);
      const title = normalizeSearchText(evt.name);
      return normalizeSearchText(dateIso).includes(searchTerm)
        || normalizeSearchText(dateShort).includes(searchTerm)
        || title.includes(searchTerm);
    })
    .sort((a, b)=>a.evt.date - b.evt.date || a.evt.name.localeCompare(b.evt.name, 'ru'));

  if(!filteredEvents.length){
    const empty = document.createElement('div');
    empty.className = 'events-empty';
    empty.textContent = searchTerm ? 'События не найдены' : 'Событий пока нет';
    eventsList.appendChild(empty);
    return;
  }

  filteredEvents.forEach(({evt, idx})=>{
    const row = document.createElement('div');
    row.className = 'event-item-row';

    const statusCheckbox = document.createElement('input');
    statusCheckbox.type = 'checkbox';
    statusCheckbox.className = 'event-status-checkbox';
    statusCheckbox.checked = evt.status === 'completed';
    statusCheckbox.title = evt.status === 'completed' ? 'Отметить как активное' : 'Отметить как завершенное';
    statusCheckbox.addEventListener('click', (e)=>e.stopPropagation());
    statusCheckbox.addEventListener('change', (e)=>{
      e.stopPropagation();
      setEventStatus(idx, statusCheckbox.checked);
    });

    const item = document.createElement('button');
    item.className = 'event-item';
    if(evt.status === 'completed') item.classList.add('completed');
    item.type = 'button';
    item.title = `${formatDateShort(evt.date)} — ${evt.name}`;
    item.innerHTML = `<span class="event-date">${formatDateShort(evt.date)}</span><span class="event-title">${evt.name}</span>`;
    item.addEventListener('click', ()=>openEditEventModal(idx));

    row.appendChild(statusCheckbox);
    row.appendChild(item);
    eventsList.appendChild(row);
  });
}

function setMode(mode){
  currentMode = mode;
  if(mode === 'timeline'){
    modeTimelineBtn.classList.add('active');
    modeCalendarBtn.classList.remove('active');
    timelineControls.style.display = 'block';
    calendarControls.style.display = 'none';
    timelineChart.style.display = 'block';
    calendarChart.style.display = 'none';
    if(typeof window.renderChart === 'function') window.renderChart();
  } else if(mode === 'calendar'){
    modeTimelineBtn.classList.remove('active');
    modeCalendarBtn.classList.add('active');
    timelineControls.style.display = 'none';
    calendarControls.style.display = 'block';
    timelineChart.style.display = 'none';
    calendarChart.style.display = 'block';
    if(typeof window.renderCalendar === 'function') window.renderCalendar();
  }
}

// Modal management functions

function updateRelationshipLists(eventIdx){
  // Populate predecessor and successor checkboxes
  const currentEvent = eventIdx !== null ? events[eventIdx] : null;
  const currentDate = currentEvent ? currentEvent.date : new Date(createEventDateInput.value);
  
  if(!predecessorsList || !successorsList) return;
  
  predecessorsList.innerHTML = '';
  successorsList.innerHTML = '';
  
  const predecessorIds = currentEvent ? (currentEvent.predecessorIds || []) : [];
  const successorIds = currentEvent ? (currentEvent.successorIds || []) : [];
  
  // Build lists of other events grouped by date relationship
  const otherEvents = events
    .map((evt, idx) => ({evt, idx}))
    .filter(({evt}) => evt.id !== (currentEvent && currentEvent.id)); // exclude current event
  
  const predecessorEvents = otherEvents.filter(({evt}) => evt.date < currentDate);
  const successorEvents = otherEvents.filter(({evt}) => evt.date > currentDate);
  
  // Populate predecessors
  if(predecessorEvents.length === 0){
    predecessorsList.className = 'relationships-list empty';
    predecessorsList.textContent = 'Нет событий раньше этой даты';
  } else {
    predecessorsList.className = 'relationships-list';
    predecessorEvents.forEach(({evt, idx}) => {
      const isSelected = predecessorIds.includes(evt.id);
      const item = document.createElement('div');
      item.className = 'relationship-item';
      item.innerHTML = `
        <input type="checkbox" id="pred-${evt.id}" data-event-id="${evt.id}" ${isSelected ? 'checked' : ''}>
        <label for="pred-${evt.id}">
          <span class="event-date-relation">${formatDateShort(evt.date)}</span>
          <span class="event-name-relation">${evt.name}</span>
        </label>
      `;
      predecessorsList.appendChild(item);
    });
  }
  
  // Populate successors
  if(successorEvents.length === 0){
    successorsList.className = 'relationships-list empty';
    successorsList.textContent = 'Нет событий позже этой даты';
  } else {
    successorsList.className = 'relationships-list';
    successorEvents.forEach(({evt, idx}) => {
      const isSelected = successorIds.includes(evt.id);
      const item = document.createElement('div');
      item.className = 'relationship-item';
      item.innerHTML = `
        <input type="checkbox" id="succ-${evt.id}" data-event-id="${evt.id}" ${isSelected ? 'checked' : ''}>
        <label for="succ-${evt.id}">
          <span class="event-date-relation">${formatDateShort(evt.date)}</span>
          <span class="event-name-relation">${evt.name}</span>
        </label>
      `;
      successorsList.appendChild(item);
    });
  }
}

function getSelectedRelationships(){
  const selectedPredecessors = Array.from(
    (predecessorsList || {}).querySelectorAll('input[type="checkbox"]:checked')
  ).map(cb => parseInt(cb.getAttribute('data-event-id'), 10));
  
  const selectedSuccessors = Array.from(
    (successorsList || {}).querySelectorAll('input[type="checkbox"]:checked')
  ).map(cb => parseInt(cb.getAttribute('data-event-id'), 10));
  
  return { predecessorIds: selectedPredecessors, successorIds: selectedSuccessors };
}

function openCreateEventModal(dateStr){
  eventModalMode = 'create';
  pendingEventId = null;
  if(eventModalTitle) eventModalTitle.textContent = 'Создать событие';
  if(eventModalSaveBtn) eventModalSaveBtn.textContent = 'Создать';
  if(eventModalDeleteBtn) eventModalDeleteBtn.style.display = 'none';
  // If dateStr provided (clicked on a day), prefill date input, otherwise set to today
  if(createEventDateInput){
    if(dateStr) createEventDateInput.value = dateStr;
    else createEventDateInput.value = formatDateForInput(new Date());
  }
  if(createEventInput) createEventInput.value = '';
  if(createEventColorInput) createEventColorInput.value = '#ff6b6b';
  if(createEventDescInput) createEventDescInput.innerHTML = '';
  if(createEventTagInput) createEventTagInput.value = '';
  if(createEventCompletedInput) createEventCompletedInput.checked = false;
  updateRelationshipLists(null);
  if(eventModal) eventModal.style.display = 'flex';
  if(createEventInput) createEventInput.focus();
}

function closeEventModal(){
  pendingEventId = null;
  if(eventModal) eventModal.style.display = 'none';
}

function saveEventFromModal(){
  const name = createEventInput ? createEventInput.value.trim() : '';
  const dateStr = createEventDateInput ? createEventDateInput.value : '';
  const color = createEventColorInput ? createEventColorInput.value : '#ff6b6b';
  const desc = createEventDescInput ? createEventDescInput.innerHTML.trim() : '';
  const tag = createEventTagInput ? createEventTagInput.value.trim() : '';
  const status = createEventCompletedInput && createEventCompletedInput.checked ? 'completed' : 'active';
  const relationships = getSelectedRelationships();
  
  if(!dateStr || !name){
    alert('Введите дату и название события');
    return;
  }
  const eventDate = new Date(dateStr);
  if(isNaN(eventDate)){
    alert('Некорректная дата');
    return;
  }
  
  if(eventModalMode === 'edit' && pendingEventId !== null){
    const eventIndex = getEventIndexById(pendingEventId);
    if(eventIndex === -1) return;
    events[eventIndex].date = eventDate;
    events[eventIndex].name = name;
    events[eventIndex].color = color;
    events[eventIndex].description = desc;
    events[eventIndex].tag = tag;
    events[eventIndex].status = status;
    events[eventIndex].predecessorIds = relationships.predecessorIds;
    events[eventIndex].successorIds = relationships.successorIds;
    // Preserve verticalOffset on edit
    if(!events[eventIndex].verticalOffset) events[eventIndex].verticalOffset = 0;
    // Update bidirectional relationships
    updateBidirectionalRelationships(events[eventIndex].id);
  } else {
    const newEventId = generateEventId();
    events.push({
      id: newEventId,
      date: eventDate, 
      name, 
      color, 
      description: desc, 
      tag, 
      status,
      predecessorIds: relationships.predecessorIds,
      successorIds: relationships.successorIds,
      verticalOffset: 0
    });
    // Update bidirectional relationships for new event
    updateBidirectionalRelationships(newEventId);
  }
  updateEventsList();
  queueDataFileSave();
  if(currentMode === 'timeline') renderChart();
  else renderCalendar();
  closeEventModal();
}

function updateBidirectionalRelationships(eventId){
  const event = getEventById(eventId);
  if(!event) return;
  if(!event.predecessorIds) event.predecessorIds = [];
  if(!event.successorIds) event.successorIds = [];
  
  // For each predecessor, ensure this event is in their successors
  event.predecessorIds.forEach(predId => {
    const predecessorEvent = getEventById(predId);
    if(predecessorEvent){
      if(!predecessorEvent.successorIds) predecessorEvent.successorIds = [];
      if(!predecessorEvent.successorIds.includes(event.id)){
        predecessorEvent.successorIds.push(event.id);
      }
    }
  });
  
  // For each successor, ensure this event is in their predecessors
  event.successorIds.forEach(succId => {
    const successorEvent = getEventById(succId);
    if(successorEvent){
      if(!successorEvent.predecessorIds) successorEvent.predecessorIds = [];
      if(!successorEvent.predecessorIds.includes(event.id)){
        successorEvent.predecessorIds.push(event.id);
      }
    }
  });
}

async function setCurrentEventsFromApi(loadedEvents){
  events.splice(0, events.length, ...loadedEvents);
  syncNextEventIdFromEvents();
  updateEventsList();
  if(currentMode === 'timeline' && typeof window.renderChart === 'function') window.renderChart();
  if(currentMode === 'calendar' && typeof window.renderCalendar === 'function') window.renderCalendar();
}

async function loadEventsFromApi(){
  try{
    const loadedEvents = await fetchEventsFromApi();
    await setCurrentEventsFromApi(loadedEvents);
    updateSyncStatus('Данные загружены с сервера');
  }catch(error){
    console.warn('Не удалось загрузить календарь с сервера', error);
    await setCurrentEventsFromApi([]);
    updateSyncStatus('Не удалось загрузить данные с сервера');
  }
}

async function saveEventsToServer(){
  try{
    await saveEventsToApi();
    updateSyncStatus('Изменения сохранены на сервер');
  }catch(error){
    console.warn('Не удалось сохранить календарь на сервер', error);
    updateSyncStatus('Не удалось сохранить изменения');
  }
}

async function initializeDataSource(){
  updateSyncStatus('Загрузка данных с сервера...');
  await loadEventsFromApi();
}

// Editor toolbar helpers using execCommand
function bindEditorToolbar(toolbarId, editorId, fontNameId, fontSizeId){
  const toolbar = $(toolbarId);
  const editor = $(editorId);
  if(!toolbar || !editor) return;
  toolbar.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-cmd]');
    if(!btn) return;
    const cmd = btn.getAttribute('data-cmd');
    if(cmd === 'createLink'){
      const url = prompt('Введите URL (например https://...)');
      if(url) document.execCommand('createLink', false, url);
    } else {
      document.execCommand(cmd, false, null);
    }
    editor.focus();
  });
  const fontSel = $(fontNameId);
  if(fontSel){
    fontSel.addEventListener('change', ()=>{
      const val = fontSel.value;
      if(val) document.execCommand('fontName', false, val);
      editor.focus();
      fontSel.selectedIndex = 0;
    });
  }
  const sizeSel = $(fontSizeId);
  if(sizeSel){
    sizeSel.addEventListener('change', ()=>{
      const val = sizeSel.value;
      if(val) document.execCommand('fontSize', false, val);
      editor.focus();
      sizeSel.selectedIndex = 0;
    });
  }
}

// Bind toolbars on load
document.addEventListener('DOMContentLoaded', async ()=>{
  bindEditorToolbar('createEditorToolbar','createEventDesc','createFontName','createFontSize');
  await initializeDataSource();
});

function openEditEventModal(eventIdx){
  const evt = events[eventIdx];
  if(!evt) return;
  ensureEventDefaults(evt);
  eventModalMode = 'edit';
  pendingEventId = evt.id;
  if(eventModalTitle) eventModalTitle.textContent = 'Редактировать событие';
  if(eventModalSaveBtn) eventModalSaveBtn.textContent = 'Сохранить';
  if(eventModalDeleteBtn) eventModalDeleteBtn.style.display = 'inline-block';
  if(createEventDateInput) createEventDateInput.value = formatDateForInput(evt.date);
  if(createEventInput) createEventInput.value = evt.name;
  if(createEventColorInput) createEventColorInput.value = evt.color || '#ff6b6b';
  if(createEventTagInput) createEventTagInput.value = evt.tag || '';
  if(createEventCompletedInput) createEventCompletedInput.checked = evt.status === 'completed';
  if(createEventDescInput) createEventDescInput.innerHTML = evt.description || '';
  updateRelationshipLists(eventIdx);
  if(eventModal) eventModal.style.display = 'flex';
  if(createEventInput) createEventInput.focus();
}

function deleteEventFromModal(){
  if(pendingEventId !== null){
    if(confirm('Удалить событие?')){
      removeEventById(pendingEventId);
      closeEventModal();
    }
  }
}

// Make modal functions global
window.openCreateEventModal = openCreateEventModal;
window.closeEventModal = closeEventModal;
window.closeCreateEventModal = closeEventModal;
window.saveEventFromModal = saveEventFromModal;
window.openEditEventModal = openEditEventModal;
window.closeEditEventModal = closeEventModal;
window.saveEditedEvent = saveEventFromModal;
window.deleteEventFromModal = deleteEventFromModal;
window.isEventVisibleByStatus = isEventVisibleByStatus;
window.getVisibleEventsForViews = getVisibleEventsForViews;
window.saveEventsToStorage = queueDataFileSave;
window.queueDataFileSave = queueDataFileSave;
window.loadEventsFromApi = loadEventsFromApi;
window.saveEventsToApi = saveEventsToApi;
window.initializeDataSource = initializeDataSource;
window.getEventIndexById = getEventIndexById;
window.getEventById = getEventById;
window.removeEventById = removeEventById;

// Close modals on Escape key
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){
    closeEventModal();
  }
});

