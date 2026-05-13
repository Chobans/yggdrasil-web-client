// Main app logic

function $(id){return document.getElementById(id)}

// Common state
const MS_PER_DAY = 24*3600*1000;
let viewportDays = 30;
let centerDate = new Date();
const MIN_DAYS = 1;
const MAX_DAYS = 365*200;
let events = []; // array of {date, name, color, description, tag, predecessorIds[], successorIds[]}
let viewStatusFilter = 'all'; // all | active | completed
let currentMode = 'timeline'; // 'timeline' or 'calendar'
let calendarMonth = new Date(); // current month for calendar view
let pendingEventIdx = null; // for calendar event editing
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
const openJsonBtn = $('openJsonBtn');
const saveJsonBtn = $('saveJsonBtn');
const saveJsonAsBtn = $('saveJsonAsBtn');
const jsonFileStatus = $('jsonFileStatus');
const DATA_FILE_DB_NAME = 'yggdrasil-web-client-file-handle';
const DATA_FILE_DB_VERSION = 1;
const DATA_FILE_STORE_NAME = 'fileHandles';
const DATA_FILE_STORAGE_KEY = 'events';
let dataFileHandle = null;
let dataSaveQueue = Promise.resolve();

function openDataFileDb(){
  return new Promise((resolve, reject)=>{
    const request = indexedDB.open(DATA_FILE_DB_NAME, DATA_FILE_DB_VERSION);
    request.onupgradeneeded = ()=>{
      if(!request.result.objectStoreNames.contains(DATA_FILE_STORE_NAME)){
        request.result.createObjectStore(DATA_FILE_STORE_NAME);
      }
    };
    request.onsuccess = ()=>resolve(request.result);
    request.onerror = ()=>reject(request.error);
  });
}

async function persistDataFileHandle(handle){
  try{
    const db = await openDataFileDb();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(DATA_FILE_STORE_NAME, 'readwrite');
      try{
        tx.objectStore(DATA_FILE_STORE_NAME).put(handle, DATA_FILE_STORAGE_KEY);
      }catch(error){
        if(error && error.name === 'DataCloneError'){
          console.warn('Handle файла не удалось сохранить в IndexedDB, продолжаем без автоподхвата');
          resolve();
          return;
        }
        reject(error);
        return;
      }
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>{
        const error = tx.error;
        if(error && error.name === 'DataCloneError'){
          console.warn('Handle файла не удалось сохранить в IndexedDB, продолжаем без автоподхвата');
          resolve();
          return;
        }
        reject(error || new Error('Не удалось сохранить handle файла'));
      };
    });
  }catch(error){
    if(error && error.name === 'DataCloneError'){
      console.warn('Handle файла не удалось сохранить в IndexedDB, продолжаем без автоподхвата');
      return;
    }
    throw error;
  }
}

async function restorePersistedDataFileHandle(){
  try{
    const db = await openDataFileDb();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(DATA_FILE_STORE_NAME, 'readonly');
      const request = tx.objectStore(DATA_FILE_STORE_NAME).get(DATA_FILE_STORAGE_KEY);
      request.onsuccess = ()=>resolve(request.result || null);
      request.onerror = ()=>reject(request.error);
    });
  }catch(error){
    console.warn('Не удалось восстановить handle файла', error);
    return null;
  }
}

function getDataFileDisplayName(handle){
  if(handle && handle.name) return handle.name;
  return 'JSON файл не выбран';
}

function updateJsonFileStatus(text){
  if(jsonFileStatus) jsonFileStatus.textContent = text;
}

function cloneEventForFile(evt){
  return {
    date: evt.date instanceof Date ? evt.date.toISOString() : evt.date,
    name: evt.name || '',
    color: evt.color || '#ff6b6b',
    description: evt.description || '',
    tag: evt.tag || '',
    status: evt.status === 'completed' ? 'completed' : 'active',
    predecessorIds: Array.isArray(evt.predecessorIds) ? evt.predecessorIds.slice() : [],
    successorIds: Array.isArray(evt.successorIds) ? evt.successorIds.slice() : [],
    verticalOffset: Number.isFinite(evt.verticalOffset) ? evt.verticalOffset : 0
  };
}

function normalizeLoadedEvent(rawEvt){
  const date = new Date(rawEvt && rawEvt.date ? rawEvt.date : Date.now());
  if(isNaN(date)) return null;
  return {
    date,
    name: String(rawEvt && rawEvt.name ? rawEvt.name : ''),
    color: rawEvt && rawEvt.color ? rawEvt.color : '#ff6b6b',
    description: rawEvt && rawEvt.description ? String(rawEvt.description) : '',
    tag: rawEvt && rawEvt.tag ? String(rawEvt.tag) : '',
    status: rawEvt && rawEvt.status === 'completed' ? 'completed' : 'active',
    predecessorIds: Array.isArray(rawEvt && rawEvt.predecessorIds) ? rawEvt.predecessorIds.filter(Number.isInteger) : [],
    successorIds: Array.isArray(rawEvt && rawEvt.successorIds) ? rawEvt.successorIds.filter(Number.isInteger) : [],
    verticalOffset: Number.isFinite(rawEvt && rawEvt.verticalOffset) ? rawEvt.verticalOffset : 0
  };
}

function buildFilePayload(){
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    events: events.map(cloneEventForFile)
  };
}

function parseEventsFromJsonText(text){
  const parsed = JSON.parse(text);
  const eventArray = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.events) ? parsed.events : null;
  if(!eventArray) throw new Error('JSON должен содержать массив events');
  return eventArray.map(normalizeLoadedEvent).filter(Boolean);
}

async function readJsonFileFromHandle(handle){
  const file = await handle.getFile();
  const text = await file.text();
  return parseEventsFromJsonText(text);
}

async function writeJsonFileToHandle(handle){
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(buildFilePayload(), null, 2));
  await writable.close();
}

function queueDataFileSave(){
  if(!dataFileHandle) return Promise.resolve();
  dataSaveQueue = dataSaveQueue
    .then(()=>writeJsonFileToHandle(dataFileHandle))
    .catch(error=>{
      console.warn('Не удалось сохранить JSON файл', error);
    });
  return dataSaveQueue;
}

function loadLegacyEventsFromLocalStorage(){
  try{
    const raw = localStorage.getItem('yggdrasil-web-client.events.v1');
    if(!raw) return false;
    const parsed = JSON.parse(raw);
    const legacyEvents = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.events) ? parsed.events : null;
    if(!legacyEvents) return false;
    const loaded = legacyEvents.map(normalizeLoadedEvent).filter(Boolean);
    events.splice(0, events.length, ...loaded);
    updateJsonFileStatus('Загружены старые данные. Выберите JSON файл для сохранения');
    return true;
  }catch(error){
    console.warn('Не удалось загрузить legacy данные', error);
    return false;
  }
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

if(openJsonBtn) openJsonBtn.addEventListener('click', ()=>openJsonFile());
if(saveJsonBtn) saveJsonBtn.addEventListener('click', ()=>saveJsonFile(false));
if(saveJsonAsBtn) saveJsonAsBtn.addEventListener('click', ()=>saveJsonFile(true));

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
    .filter(({idx}) => idx !== eventIdx); // exclude current event
  
  const predecessorEvents = otherEvents.filter(({evt}) => evt.date < currentDate);
  const successorEvents = otherEvents.filter(({evt}) => evt.date > currentDate);
  
  // Populate predecessors
  if(predecessorEvents.length === 0){
    predecessorsList.className = 'relationships-list empty';
    predecessorsList.textContent = 'Нет событий раньше этой даты';
  } else {
    predecessorsList.className = 'relationships-list';
    predecessorEvents.forEach(({evt, idx}) => {
      const isSelected = predecessorIds.includes(idx);
      const item = document.createElement('div');
      item.className = 'relationship-item';
      item.innerHTML = `
        <input type="checkbox" id="pred-${idx}" data-event-idx="${idx}" ${isSelected ? 'checked' : ''}>
        <label for="pred-${idx}">
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
      const isSelected = successorIds.includes(idx);
      const item = document.createElement('div');
      item.className = 'relationship-item';
      item.innerHTML = `
        <input type="checkbox" id="succ-${idx}" data-event-idx="${idx}" ${isSelected ? 'checked' : ''}>
        <label for="succ-${idx}">
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
  ).map(cb => parseInt(cb.getAttribute('data-event-idx'), 10));
  
  const selectedSuccessors = Array.from(
    (successorsList || {}).querySelectorAll('input[type="checkbox"]:checked')
  ).map(cb => parseInt(cb.getAttribute('data-event-idx'), 10));
  
  return { predecessorIds: selectedPredecessors, successorIds: selectedSuccessors };
}

function openCreateEventModal(dateStr){
  eventModalMode = 'create';
  pendingEventIdx = null;
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
  pendingEventIdx = null;
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
  
  if(eventModalMode === 'edit' && pendingEventIdx !== null){
    events[pendingEventIdx].date = eventDate;
    events[pendingEventIdx].name = name;
    events[pendingEventIdx].color = color;
    events[pendingEventIdx].description = desc;
    events[pendingEventIdx].tag = tag;
    events[pendingEventIdx].status = status;
    events[pendingEventIdx].predecessorIds = relationships.predecessorIds;
    events[pendingEventIdx].successorIds = relationships.successorIds;
    // Preserve verticalOffset on edit
    if(!events[pendingEventIdx].verticalOffset) events[pendingEventIdx].verticalOffset = 0;
    // Update bidirectional relationships
    updateBidirectionalRelationships(pendingEventIdx);
  } else {
    events.push({
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
    updateBidirectionalRelationships(events.length - 1);
  }
  updateEventsList();
  queueDataFileSave();
  if(currentMode === 'timeline') renderChart();
  else renderCalendar();
  closeEventModal();
}

function updateBidirectionalRelationships(eventIdx){
  const event = events[eventIdx];
  if(!event.predecessorIds) event.predecessorIds = [];
  if(!event.successorIds) event.successorIds = [];
  
  // For each predecessor, ensure this event is in their successors
  event.predecessorIds.forEach(predIdx => {
    if(events[predIdx]){
      if(!events[predIdx].successorIds) events[predIdx].successorIds = [];
      if(!events[predIdx].successorIds.includes(eventIdx)){
        events[predIdx].successorIds.push(eventIdx);
      }
    }
  });
  
  // For each successor, ensure this event is in their predecessors
  event.successorIds.forEach(succIdx => {
    if(events[succIdx]){
      if(!events[succIdx].predecessorIds) events[succIdx].predecessorIds = [];
      if(!events[succIdx].predecessorIds.includes(eventIdx)){
        events[succIdx].predecessorIds.push(eventIdx);
      }
    }
  });
}

async function ensureJsonFilePermission(handle, mode){
  if(!handle) return false;
  if(typeof handle.queryPermission !== 'function' || typeof handle.requestPermission !== 'function') return true;
  const queryResult = await handle.queryPermission({mode});
  if(queryResult === 'granted') return true;
  const requestResult = await handle.requestPermission({mode});
  return requestResult === 'granted';
}

async function setCurrentDataFileHandle(handle){
  dataFileHandle = handle;
  await persistDataFileHandle(handle);
  updateJsonFileStatus(`JSON файл: ${getDataFileDisplayName(handle)}`);
}

async function loadEventsFromDataFileHandle(handle){
  const loadedEvents = await readJsonFileFromHandle(handle);
  events.splice(0, events.length, ...loadedEvents);
  await setCurrentDataFileHandle(handle);
  updateEventsList();
  if(currentMode === 'timeline' && typeof window.renderChart === 'function') window.renderChart();
  if(currentMode === 'calendar' && typeof window.renderCalendar === 'function') window.renderCalendar();
}

async function openJsonFile(){
  try{
    if(window.showOpenFilePicker){
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JSON files', accept: {'application/json': ['.json']} }]
      });
      if(!handle) return;
      if(!(await ensureJsonFilePermission(handle, 'read'))){
        alert('Нет доступа к JSON файлу для чтения');
        return;
      }
      await loadEventsFromDataFileHandle(handle);
      return;
    }
    alert('Этот браузер не поддерживает выбор локального файла для чтения');
  }catch(error){
    if(error && error.name !== 'AbortError'){
      alert('Не удалось открыть JSON файл');
      console.error(error);
    }
  }
}

async function saveJsonFile(forceSaveAs = false){
  try{
    if(forceSaveAs || !dataFileHandle){
      if(!window.showSaveFilePicker){
        const blob = new Blob([JSON.stringify(buildFilePayload(), null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'yggdrasil-data.json';
        link.click();
        URL.revokeObjectURL(url);
        updateJsonFileStatus('JSON скачан как файл yggdrasil-data.json');
        return;
      }
      const handle = await window.showSaveFilePicker({
        suggestedName: dataFileHandle && dataFileHandle.name ? dataFileHandle.name : 'yggdrasil-data.json',
        types: [{ description: 'JSON files', accept: {'application/json': ['.json']} }]
      });
      if(!handle) return;
      if(!(await ensureJsonFilePermission(handle, 'readwrite'))){
        alert('Нет доступа к JSON файлу для записи');
        return;
      }
      await setCurrentDataFileHandle(handle);
    } else if(!(await ensureJsonFilePermission(dataFileHandle, 'readwrite'))){
      alert('Нет доступа к JSON файлу для записи');
      return;
    }

    await writeJsonFileToHandle(dataFileHandle);
    updateJsonFileStatus(`JSON файл: ${getDataFileDisplayName(dataFileHandle)}`);
  }catch(error){
    if(error && error.name !== 'AbortError'){
      alert('Не удалось сохранить JSON файл');
      console.error(error);
    }
  }
}

async function initializeDataSource(){
  const restoredHandle = await restorePersistedDataFileHandle();
  if(restoredHandle && await ensureJsonFilePermission(restoredHandle, 'read')){
    try{
      await loadEventsFromDataFileHandle(restoredHandle);
      return;
    }catch(error){
      console.warn('Не удалось прочитать сохраненный JSON файл', error);
    }
  }

  if(loadLegacyEventsFromLocalStorage()){
    updateEventsList();
    if(typeof window.renderChart === 'function') window.renderChart();
    if(typeof window.renderCalendar === 'function' && currentMode === 'calendar') window.renderCalendar();
    return;
  }

  updateJsonFileStatus('JSON файл не выбран');
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
  updateEventsList();
  if(typeof window.renderChart === 'function') window.renderChart();
  if(typeof window.renderCalendar === 'function' && currentMode === 'calendar') window.renderCalendar();
});

function openEditEventModal(eventIdx){
  const evt = events[eventIdx];
  ensureEventDefaults(evt);
  eventModalMode = 'edit';
  pendingEventIdx = eventIdx;
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
  if(pendingEventIdx !== null){
    if(confirm('Удалить событие?')){
      removeEvent(pendingEventIdx);
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
window.openJsonFile = openJsonFile;
window.saveJsonFile = saveJsonFile;
window.initializeDataSource = initializeDataSource;

// Close modals on Escape key
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){
    closeEventModal();
  }
});

