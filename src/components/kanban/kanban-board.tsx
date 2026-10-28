'use client';

// ============================================================
// Generic drag-and-drop board (Trello style) for the Equipo tabs:
// publications by status, collections by stage, collabs by status.
// Same @dnd-kit setup as the deals board in
// src/components/pipelines/pipeline-board.tsx — 5px activation so a
// click still opens a card, keyboard sensor for accessibility — but
// columns are a fixed list passed in rather than pipeline stages.
// ============================================================

import { useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface KanbanColumn<K extends string> {
  key: K;
  label: string;
  /** Tailwind background class for the column's top bar. */
  accent: string;
  /** Optional line under the title, e.g. a total. */
  hint?: string;
}

export function KanbanBoard<T extends { id: string }, K extends string>({
  columns,
  items,
  columnOf,
  renderCard,
  onMove,
  onAdd,
  addLabel,
  emptyLabel,
}: {
  columns: KanbanColumn<K>[];
  items: T[];
  columnOf: (item: T) => K;
  renderCard: (item: T) => ReactNode;
  onMove: (item: T, to: K) => void;
  /** Shows a "+" at the foot of every column when given. */
  onAdd?: (column: K) => void;
  addLabel?: string;
  emptyLabel: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );
  const active = activeId ? items.find((i) => i.id === activeId) : undefined;

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active: dragged, over } = event;
    if (!over) return;
    const item = items.find((i) => i.id === String(dragged.id));
    const to = String(over.id) as K;
    if (!item || columnOf(item) === to) return;
    if (!columns.some((c) => c.key === to)) return;
    onMove(item, to);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 lg:snap-none">
        {columns.map((column) => (
          <Column
            key={column.key}
            column={column}
            items={items.filter((i) => columnOf(i) === column.key)}
            renderCard={renderCard}
            onAdd={onAdd}
            addLabel={addLabel}
            emptyLabel={emptyLabel}
          />
        ))}
      </div>
      <DragOverlay
        dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}
      >
        {active ? <div className="opacity-90">{renderCard(active)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column<T extends { id: string }, K extends string>({
  column,
  items,
  renderCard,
  onAdd,
  addLabel,
  emptyLabel,
}: {
  column: KanbanColumn<K>;
  items: T[];
  renderCard: (item: T) => ReactNode;
  onAdd?: (column: K) => void;
  addLabel?: string;
  emptyLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <div className="border-border bg-card/60 flex w-[80vw] max-w-[300px] min-w-[240px] shrink-0 snap-start flex-col rounded-xl border p-3 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[240px] lg:snap-none">
      <div className={cn('-mx-3 -mt-3 h-[3px] rounded-t-xl', column.accent)} />
      <div className="flex items-center justify-between pt-2">
        <h3 className="truncate text-sm font-semibold">{column.label}</h3>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
          {items.length}
        </span>
      </div>
      {column.hint && (
        <p className="text-muted-foreground text-xs">{column.hint}</p>
      )}
      <div
        ref={setNodeRef}
        className={cn(
          'mt-2 flex min-h-24 flex-1 flex-col gap-2 rounded-lg transition-all',
          isOver &&
            'bg-primary/5 outline-primary outline-2 outline-offset-2 outline-dashed'
        )}
      >
        {items.length === 0 ? (
          <div className="border-border text-muted-foreground flex flex-1 items-center justify-center rounded-lg border-2 border-dashed py-8 text-xs">
            {emptyLabel}
          </div>
        ) : (
          items.map((item) => (
            <DraggableCard key={item.id} id={item.id}>
              {renderCard(item)}
            </DraggableCard>
          ))
        )}
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={() => onAdd(column.key)}
          className="border-border text-muted-foreground hover:bg-muted hover:text-foreground mt-2 flex w-full items-center gap-1 rounded-md border border-dashed px-2 py-1.5 text-xs"
        >
          <Plus className="h-3 w-3" />
          {addLabel}
        </button>
      )}
    </div>
  );
}

function DraggableCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: 'none' }}
    >
      {children}
    </div>
  );
}
