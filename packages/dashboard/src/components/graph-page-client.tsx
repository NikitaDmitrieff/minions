'use client'

import { useState } from 'react'
import { BranchGraph } from './branch-graph'
import { ScheduledPanel } from './scheduled-panel'
import { EventSlideOver } from './event-slide-over'
import type { BranchEvent } from '@/lib/types'

export function GraphPageClient({ projectId }: { projectId: string }) {
  const [selectedEvent, setSelectedEvent] = useState<BranchEvent | null>(null)

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* Branch graph */}
        <BranchGraph projectId={projectId} onEventClick={setSelectedEvent} />

        {/* Scheduled panel */}
        <ScheduledPanel projectId={projectId} />
      </div>

      {/* Event slide-over */}
      {selectedEvent && (
        <EventSlideOver
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </>
  )
}
