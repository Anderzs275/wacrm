'use client';

// ============================================================
// Equipo — the team's internal home (fork feature).
//
// A thin strip on top (next meeting, who is online), then three tabs:
//   - Calendario: the content calendar that replaced the marketing
//     Excel (month / list / board), today's agenda, who is connected,
//     and the rarely touched team labels and brands.
//   - Colecciones: collection launches on a board by stage, each with
//     its checklist (108).
//   - Colaboraciones: influencer and brand collabs on a board (108).
// Launch and collab dates also show on the calendar; clicking one
// jumps to its tab with it open.
//
// Visible to every member, including the 'team' role. What each role
// may change is enforced by RLS (101–108); the page only hides
// controls that would fail.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Handshake, Layers, Loader2 } from 'lucide-react';

import { BrandsCard } from '@/components/calendar/brands-card';
import {
  CalendarCard,
  type CalendarMilestone,
} from '@/components/calendar/calendar-card';
import {
  EventDialog,
  eventDraftFrom,
  newEventDraft,
  type EventDraft,
} from '@/components/calendar/event-dialog';
import {
  PostDialog,
  draftFrom,
  newDraft,
  type PostDraft,
} from '@/components/calendar/post-dialog';
import { TodayCard } from '@/components/calendar/today-card';
import { useContentCalendar } from '@/components/calendar/use-content-calendar';
import { CollabsTab } from '@/components/collabs/collabs-tab';
import {
  collabDraftFrom,
  type CollabDraft,
} from '@/components/collabs/collab-dialog';
import { useCollaborations } from '@/components/collabs/use-collaborations';
import {
  collectionDraftFrom,
  type CollectionDraft,
} from '@/components/collections/collection-dialog';
import { CollectionsTab } from '@/components/collections/collections-tab';
import { useCollections } from '@/components/collections/use-collections';
import { GroupsCard } from '@/components/team/groups-card';
import { RosterCard } from '@/components/team/roster-card';
import { TeamStrip } from '@/components/team/team-strip';
import { useTeamSpace } from '@/components/team/use-team-space';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import { monthOf, shiftMonth, toIsoDay } from '@/lib/calendar/month-grid';
import { cn } from '@/lib/utils';

type Tab = 'calendar' | 'collections' | 'collabs';

const TABS: { key: Tab; icon: typeof CalendarDays }[] = [
  { key: 'calendar', icon: CalendarDays },
  { key: 'collections', icon: Layers },
  { key: 'collabs', icon: Handshake },
];

export default function TeamPage() {
  const t = useTranslations('Team');
  const { user, canManageMembers } = useAuth();
  const space = useTeamSpace();
  // One presence subscription for the whole page (strip + roster).
  const presence = usePresence();
  const [tab, setTab] = useState<Tab>('calendar');

  const [now, setNow] = useState(() => Date.now());
  // Keeps "today" and the next-meeting strip current without a reload.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const today = toIsoDay(new Date(now));

  const [month, setMonth] = useState(() => monthOf(toIsoDay(new Date())));
  const calendar = useContentCalendar(month, today);
  const { collections, reload: reloadCollections } = useCollections();
  const { collabs, reload: reloadCollabs } = useCollaborations();

  const [draft, setDraft] = useState<PostDraft | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [collectionDraft, setCollectionDraft] =
    useState<CollectionDraft | null>(null);
  const [collabDraft, setCollabDraft] = useState<CollabDraft | null>(null);

  const milestones = useMemo<CalendarMilestone[]>(
    () => [
      ...collections.flatMap((c) =>
        c.launch_date
          ? [
              {
                id: c.id,
                kind: 'launch' as const,
                title: c.name,
                day: c.launch_date,
              },
            ]
          : []
      ),
      ...collabs.flatMap((c) =>
        c.publish_date && c.status !== 'declined'
          ? [
              {
                id: c.id,
                kind: 'collab' as const,
                title: c.name,
                day: c.publish_date,
              },
            ]
          : []
      ),
    ],
    [collections, collabs]
  );

  function openMilestone(m: CalendarMilestone) {
    if (m.kind === 'launch') {
      const c = collections.find((x) => x.id === m.id);
      if (!c) return;
      setTab('collections');
      setCollectionDraft(collectionDraftFrom(c));
    } else {
      const c = collabs.find((x) => x.id === m.id);
      if (!c) return;
      setTab('collabs');
      setCollabDraft(collabDraftFrom(c));
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-foreground text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t('subtitle')}
        </p>
      </div>

      {space.loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('loading')}
        </div>
      ) : (
        <>
          <TeamStrip
            nextMeetings={calendar.nextMeetings}
            today={today}
            members={space.members}
            presence={presence}
          />

          <nav
            aria-label={t('tabs.label')}
            // Scrolls sideways on narrow screens, never vertically, and
            // without a visible scrollbar. The active underline is an
            // inset shadow rather than a border pulled down over the
            // nav's border, which is what made it overflow by 1px.
            className="border-border flex gap-1 overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TABS.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => setTab(key)}
                className={cn(
                  'flex shrink-0 items-center gap-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === key
                    ? 'text-primary shadow-[inset_0_-2px_0_0_currentColor]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {t(`tabs.${key}`)}
              </button>
            ))}
          </nav>

          {tab === 'calendar' && (
            <>
              <CalendarCard
                month={month}
                onMonthChange={(delta) =>
                  setMonth(
                    delta === 'today'
                      ? monthOf(today)
                      : shiftMonth(month, delta)
                  )
                }
                today={today}
                posts={calendar.posts}
                events={calendar.events}
                members={space.members}
                brands={calendar.brands}
                onOpenPost={(post) => setDraft(draftFrom(post))}
                onNewPost={(day, status) =>
                  setDraft({ ...newDraft(day), status: status ?? 'pending' })
                }
                onOpenEvent={(event) => setEventDraft(eventDraftFrom(event))}
                onNewEvent={(day) => setEventDraft(newEventDraft(day))}
                canDelete={canManageMembers}
                onChanged={() => void calendar.reload()}
                milestones={milestones}
                onOpenMilestone={openMilestone}
              />

              <div className="grid gap-6 lg:grid-cols-5">
                <div className="lg:col-span-3">
                  <TodayCard
                    posts={calendar.agendaPosts}
                    events={calendar.agendaEvents}
                    brands={calendar.brands}
                    today={today}
                    members={space.members}
                    currentUserId={user?.id ?? null}
                    onOpenPost={(post) => setDraft(draftFrom(post))}
                    onOpenEvent={(event) =>
                      setEventDraft(eventDraftFrom(event))
                    }
                  />
                </div>
                <div className="lg:col-span-2">
                  <RosterCard
                    members={space.members}
                    groups={space.groups}
                    membership={space.membership}
                    canSeeLastSeen={canManageMembers}
                    presence={presence}
                  />
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <GroupsCard
                  groups={space.groups}
                  membership={space.membership}
                  members={space.members}
                  canManage={canManageMembers}
                  onChanged={space.reloadGroups}
                />
                <BrandsCard
                  brands={calendar.brands}
                  canManage={canManageMembers}
                  onChanged={() => void calendar.reload()}
                />
              </div>
            </>
          )}

          {tab === 'collections' && (
            <CollectionsTab
              collections={collections}
              brands={calendar.brands}
              members={space.members}
              today={today}
              canDelete={canManageMembers}
              onChanged={() => void reloadCollections()}
              draft={collectionDraft}
              onDraftChange={setCollectionDraft}
            />
          )}

          {tab === 'collabs' && (
            <CollabsTab
              collabs={collabs}
              members={space.members}
              today={today}
              canDelete={canManageMembers}
              onChanged={() => void reloadCollabs()}
              draft={collabDraft}
              onDraftChange={setCollabDraft}
            />
          )}
        </>
      )}

      <PostDialog
        draft={draft}
        onClose={() => setDraft(null)}
        onSaved={() => void calendar.reload()}
        members={space.members}
        brands={calendar.brands}
        canDelete={canManageMembers}
        canManageBrands={canManageMembers}
      />
      <EventDialog
        draft={eventDraft}
        onClose={() => setEventDraft(null)}
        onSaved={() => void calendar.reload()}
        isAdmin={canManageMembers}
      />
    </div>
  );
}
