// Timeline (time series) module

// Drag state for vertical repositioning
let draggedEventIdx = null;
let dragStartY = 0;
let dragStartOffset = 0;

function getDims(){
  const chart = $('chart');
  const width = chart.clientWidth || +chart.getAttribute('width');
  const height = chart.clientHeight || +chart.getAttribute('height');
  const margin = {top:20,right:20,bottom:30,left:40};
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  return {width,height,margin,innerW,innerH};
}

function getVisibleRange(){
  const half = (viewportDays/2) * MS_PER_DAY;
  const centerMs = centerDate.getTime();
  const start = new Date(Math.floor((centerMs - half) / MS_PER_DAY) * MS_PER_DAY);
  const end = new Date(Math.floor((centerMs + half) / MS_PER_DAY) * MS_PER_DAY + MS_PER_DAY - 1);
  const days = Math.max(1, Math.round((end - start)/MS_PER_DAY) + 1);
  return {start,end,days};
}

function shiftCenterBy(days){
  centerDate = new Date(centerDate.getTime() + days * MS_PER_DAY);
  renderChart();
}

function generateData(startDate, days){
  const data = [];
  for(let i=0;i<days;i++){
    const d = new Date(startDate.getTime());
    d.setUTCDate(d.getUTCDate()+i);
    data.push({date: d});
  }
  return data;
}

function renderChart(){
  const chart = $('chart');
  const rangeLabel = $('rangeLabel');
  const range = getVisibleRange();
  const data = generateData(range.start, range.days);
  const visibleEvents = typeof window.getVisibleEventsForViews === 'function'
    ? window.getVisibleEventsForViews()
    : events;

  // Initialize verticalOffset for all events if not present
  events.forEach(evt => {
    if(typeof evt.verticalOffset === 'undefined') {
      evt.verticalOffset = 0;
    }
  });

  // update label
  rangeLabel.textContent = `${range.start.toISOString().slice(0,10)} — ${range.end.toISOString().slice(0,10)} (${range.days} дн)`;

  // Clear svg
  while(chart.firstChild) chart.removeChild(chart.firstChild);

  const dims = getDims();
  const width = dims.width, height = dims.height, margin = dims.margin, innerW = dims.innerW, innerH = dims.innerH;

  // Scales
  const x0 = data[0].date.getTime();
  const x1 = data[data.length-1].date.getTime();

  const xScale = d=>{
    const t = d.getTime();
    return margin.left + ( (t - x0) / (x1 - x0 || 1) ) * innerW;
  };

  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns,'g');
  chart.appendChild(g);

  // Vertical lines for each day
  for(let i=0;i<data.length;i++){
    const d = data[i].date;
    const x = xScale(d);
    const dayLine = document.createElementNS(ns,'line');
    dayLine.setAttribute('x1', x); dayLine.setAttribute('x2', x);
    dayLine.setAttribute('y1', margin.top); dayLine.setAttribute('y2', margin.top + innerH);
    dayLine.setAttribute('stroke','#ddd'); dayLine.setAttribute('stroke-width','0.5');
    g.appendChild(dayLine);
  }

  // X axis line
  const xAxis = document.createElementNS(ns,'line');
  xAxis.setAttribute('x1', margin.left); xAxis.setAttribute('x2', margin.left + innerW);
  xAxis.setAttribute('y1', margin.top + innerH); xAxis.setAttribute('y2', margin.top + innerH);
  xAxis.setAttribute('stroke','#444'); xAxis.setAttribute('stroke-width','1');
  g.appendChild(xAxis);

  // X axis ticks
  const tickCount = Math.min(10, data.length);
  for(let i=0;i<tickCount;i++){
    const idx = Math.round(i*(data.length-1)/(tickCount-1));
    const d = data[idx];
    const x = xScale(d.date);
    const tick = document.createElementNS(ns,'line');
    tick.setAttribute('x1', x); tick.setAttribute('x2', x);
    tick.setAttribute('y1', margin.top + innerH); tick.setAttribute('y2', margin.top + innerH + 6);
    tick.setAttribute('stroke','#444');
    g.appendChild(tick);

    const label = document.createElementNS(ns,'text');
    label.setAttribute('x', x); label.setAttribute('y', margin.top + innerH + 20);
    label.setAttribute('text-anchor','middle'); label.setAttribute('font-size','11');
    label.textContent = d.date.toISOString().slice(0,10);
    g.appendChild(label);
  }

  // Events: group by date and distribute vertically
  const eventsByDate = {};
  const eventPositions = {}; // map of eventIdx -> {x, y} for drawing relationships
  
  visibleEvents.forEach((evt) => {
    const globalIdx = events.findIndex(e => e === evt);
    if(globalIdx === -1) return;
    const dateKey = evt.date.toISOString().slice(0,10);
    if(!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push({evt, globalIdx});
  });

  Object.keys(eventsByDate).forEach(dateKey => {
    const evts = eventsByDate[dateKey];
    const eventDate = new Date(dateKey);
    
    // Check if event is in visible range
    if(eventDate >= data[0].date && eventDate <= data[data.length-1].date){
      const x = xScale(eventDate);
      const eventCount = evts.length;
      
      evts.forEach(({evt, globalIdx}, idx) => {
        // Distribute events vertically: 0 -> middle, 1,2 -> above/below, etc
        const totalSpacing = innerH * 0.6; // use 60% of height for events
        let yPos = margin.top + innerH/2 + (idx - (eventCount-1)/2) * (totalSpacing / Math.max(1, eventCount-1));
        
        // Apply vertical offset if set (from user dragging)
        if(evt.verticalOffset) {
          yPos += evt.verticalOffset;
        }
        
        // Store position for relationship lines
        eventPositions[globalIdx] = {x, y: yPos, color: evt.color};
        
        const marker = document.createElementNS(ns,'circle');
        marker.setAttribute('cx', x);
        marker.setAttribute('cy', yPos);
        marker.setAttribute('r', 6);
        marker.setAttribute('fill', evt.color || '#ff6b6b');
        marker.setAttribute('stroke', '#c92a2a');
        marker.setAttribute('stroke-width','1.5');
        marker.setAttribute('title', evt.name);
        marker.setAttribute('data-event-idx', globalIdx);
        marker.style.cursor = 'grab';
        
        // Add drag handlers
        marker.addEventListener('pointerdown', (e) => startDragEvent(e, globalIdx, yPos));
        
        g.appendChild(marker);

        // Event label
        const label = document.createElementNS(ns,'text');
        label.setAttribute('x', x);
        label.setAttribute('y', yPos - 12);
        label.setAttribute('text-anchor','middle');
        label.setAttribute('font-size','11');
        label.setAttribute('fill','#d32f2f');
        label.textContent = evt.name;
        g.appendChild(label);
      });
    }
  });

  // Draw relationship lines
  visibleEvents.forEach((evt) => {
    const eventIdx = events.findIndex(e => e === evt);
    if(eventIdx === -1) return;
    if(!evt.successorIds || evt.successorIds.length === 0) return;
    if(!eventPositions[eventIdx]) return; // event not visible
    
    const fromPos = eventPositions[eventIdx];
    
    evt.successorIds.forEach(succIdx => {
      if(!eventPositions[succIdx]) return; // successor not visible
      
      const toPos = eventPositions[succIdx];
      
      // Draw curved line from event to successor
      const line = document.createElementNS(ns, 'path');
      const startX = fromPos.x;
      const startY = fromPos.y;
      const endX = toPos.x;
      const endY = toPos.y;
      
      // Use quadratic Bézier curve for relationship line
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2 - 30; // curve upward
      
      const pathData = `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
      line.setAttribute('d', pathData);
      line.setAttribute('stroke', '#999');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke-dasharray', '4,4');
      line.setAttribute('marker-end', 'url(#arrowhead)');
      g.appendChild(line);
    });
  });

  // Add arrow marker definition if not present
  if(!document.querySelector('#arrowhead')){
    const defs = document.createElementNS(ns, 'defs');
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    
    const polygon = document.createElementNS(ns, 'polygon');
    polygon.setAttribute('points', '0 0, 10 3, 0 6');
    polygon.setAttribute('fill', '#999');
    
    marker.appendChild(polygon);
    defs.appendChild(marker);
    g.insertBefore(defs, g.firstChild);
  }
}

// Drag event handlers for vertical repositioning
function startDragEvent(e, eventIdx, initialY){
  e.preventDefault();
  draggedEventIdx = eventIdx;
  dragStartY = e.clientY;
  dragStartOffset = events[eventIdx].verticalOffset || 0;
  
  const chart = $('chart');
  chart.setPointerCapture && chart.setPointerCapture(e.pointerId);
  chart.style.cursor = 'grabbing';
  
  // Add listeners for move and end
  document.addEventListener('pointermove', handleDragMove);
  document.addEventListener('pointerup', handleDragEnd);
}

function handleDragMove(e){
  if(draggedEventIdx === null) return;
  
  const deltaY = e.clientY - dragStartY;
  const newOffset = dragStartOffset + deltaY;
  
  // Clamp offset to reasonable bounds
  const maxOffset = 80;
  events[draggedEventIdx].verticalOffset = Math.max(-maxOffset, Math.min(maxOffset, newOffset));
  
  // Redraw timeline in real-time
  renderChart();
}

function handleDragEnd(e){
  if(draggedEventIdx !== null){
    draggedEventIdx = null;
    document.removeEventListener('pointermove', handleDragMove);
    document.removeEventListener('pointerup', handleDragEnd);
    if(typeof window.saveEventsToStorage === 'function') window.saveEventsToStorage();
    
    const chart = $('chart');
    chart.style.cursor = 'default';
    chart.releasePointerCapture && chart.releasePointerCapture(e.pointerId);
  }
}

window.getDims = getDims;
window.getVisibleRange = getVisibleRange;
window.shiftCenterBy = shiftCenterBy;
window.generateData = generateData;
window.renderChart = renderChart;
window.startDragEvent = startDragEvent;
window.handleDragMove = handleDragMove;
window.handleDragEnd = handleDragEnd;
