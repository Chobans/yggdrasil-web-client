// Calendar module

function renderCalendar(){
  const calendarGrid = $('calendarGrid');
  const calendarMonthLabel = $('calendarMonthLabel');
  const visibleEvents = typeof window.getVisibleEventsForViews === 'function'
    ? window.getVisibleEventsForViews()
    : events;
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  
  // Update label
  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  calendarMonthLabel.textContent = `${monthNames[month]} ${year}`;

  // Get first day of month and number of days
  // getDay() returns 0=Sun, 1=Mon, ..., 6=Sat
  // Convert to Mon-based: 0=Mon, 1=Tue, ..., 6=Sun
  let firstDay = new Date(year, month, 1).getDay();
  firstDay = (firstDay + 6) % 7; // Convert to Monday-based
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Build events by date map
  const eventsByDate = {};
  visibleEvents.forEach(evt=>{
    const dateKey = evt.date.toISOString().slice(0,10);
    if(!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push(evt);
  });

  // Clear grid
  calendarGrid.innerHTML = '';

  // Week header - add directly to grid as first 7 elements
  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  weekDays.forEach(day=>{
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day-header';
    dayEl.textContent = day;
    calendarGrid.appendChild(dayEl);
  });

  // Colors for events
  const eventColors = ['#ff6b6b', '#4dabf7', '#51cf66', '#ffa94d', '#b197fc', '#ff922b'];
  let colorIdx = 0;

  // Days
  let dayNum = 1;
  for(let week=0; week<6; week++){
    for(let day=0; day<7; day++){
      const dayCell = document.createElement('div');
      dayCell.className = 'calendar-day';

      let displayNum, displayMonth, displayYear, isCurrentMonth = false;
      if(week === 0 && day < firstDay){
        // Previous month
        displayNum = daysInPrevMonth - firstDay + day + 1;
        displayMonth = month - 1;
        displayYear = month === 0 ? year - 1 : year;
        dayCell.classList.add('other-month');
      } else if(dayNum <= daysInMonth){
        displayNum = dayNum;
        displayMonth = month;
        displayYear = year;
        isCurrentMonth = true;
        dayNum++;
      } else {
        // Next month
        displayNum = dayNum - daysInMonth;
        displayMonth = month + 1;
        displayYear = month === 11 ? year + 1 : year;
        dayCell.classList.add('other-month');
        dayNum++;
      }

      const dateStr = `${displayYear}-${String(displayMonth+1).padStart(2,'0')}-${String(displayNum).padStart(2,'0')}`;
      const dayEvts = eventsByDate[dateStr] || [];

      // Day number
      const dayNum_el = document.createElement('div');
      dayNum_el.className = 'calendar-day-number';
      dayNum_el.textContent = displayNum;
      dayCell.appendChild(dayNum_el);

      // Events as colored blocks
      if(dayEvts.length > 0 && isCurrentMonth){
        const eventsDiv = document.createElement('div');
        eventsDiv.className = 'calendar-events';
        dayEvts.forEach((evt, eventIdxInDay)=>{
          const eventBlock = document.createElement('div');
          eventBlock.className = 'calendar-event-block';
          eventBlock.style.backgroundColor = evt.color || eventColors[colorIdx % eventColors.length];
          eventBlock.style.color = '#fff';
          eventBlock.title = evt.name + (evt.description ? ' — ' + evt.description : '');
          eventBlock.textContent = evt.name.length > 12 ? evt.name.slice(0, 10) + '...' : evt.name;
          // Find global event index
          const globalIdx = typeof window.getEventIndexById === 'function'
            ? window.getEventIndexById(evt.id)
            : events.findIndex(e => Number(e.id) === Number(evt.id));
          eventBlock.addEventListener('click', (e)=>{
            e.stopPropagation();
            if(globalIdx !== -1){
              openEditEventModal(globalIdx);
            }
          });
          eventsDiv.appendChild(eventBlock);
          colorIdx++;
        });
        dayCell.appendChild(eventsDiv);
      }

      // Add click handler to day cell (only for current month)
      if(isCurrentMonth){
        dayCell.addEventListener('click', ()=>{
          openCreateEventModal(dateStr);
        });
        dayCell.style.cursor = 'pointer';
      }

      calendarGrid.appendChild(dayCell);
    }
  }
}
