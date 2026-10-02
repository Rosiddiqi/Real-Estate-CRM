// AppShell — tabs under the floating tab bar, page-like overlays pushed on top,
// floating chrome (Serena bubble, call pill, drawer, toasts). Every surface is
// lazy-loaded and wrapped in an error boundary so one broken screen can never
// take down the app.
//
// Overlay contract: each overlay component receives { ...props, overlayId, onClose }.
// Call onClose() AFTER your exit animation (PushPanel / Sheet do this for you).
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { nav, useNav } from '../../lib/nav';
import { useAuth } from '../../hooks/useAuth';
import { useKeyboardInset, useTheme } from '../../hooks/useShellEffects';
import { useResync, useSocket } from '../../hooks/useSocket';
import { api } from '../../api/client';
import TabBar from './TabBar';
import SideMenu from './SideMenu';
import ErrorBoundary from './ErrorBoundary';
import { Toaster, ConfirmHost } from '../ui/toast';
import { OverlayDepth } from '../ui/depth';
import Login from '../../pages/auth/Login';
import { useOnboarding } from '../../hooks/useOnboarding';
import AssistantBuilder from '../onboarding/AssistantBuilder';
import OnboardingChecklist from '../onboarding/OnboardingChecklist';

// ── Tab roots ────────────────────────────────────────────────────────────
const TAB_PAGES = {
  home: lazy(() => import('../../pages/dashboard/Dashboard.jsx')),
  inbox: lazy(() => import('../../pages/inbox/InboxPage.jsx')),
  phone: lazy(() => import('../../pages/phone/PhonePage.jsx')),
  clients: lazy(() => import('../../pages/clients/ClientsPage.jsx')),
  matchmaker: lazy(() => import('../../pages/matchmaker/MatchmakerPage.jsx')),
};

// ── Overlay registry: type → component (owner in comments) ─────────────────
const OVERLAYS = {
  // clients
  client: lazy(() => import('../client/ClientCard.jsx')),
  newClient: lazy(() => import('../client/AddClientSheet.jsx')),
  waitlists: lazy(() => import('../../pages/clients/WaitlistsPage.jsx')),
  import: lazy(() => import('../../pages/clients/ImportPage.jsx')),
  // messaging
  thread: lazy(() => import('../thread/ThreadPanel.jsx')),
  compose: lazy(() => import('../thread/ComposePanel.jsx')),
  quickText: lazy(() => import('../thread/QuickTextSheet.jsx')),
  // pipeline + money
  pipeline: lazy(() => import('../../pages/pipeline/PipelinePage.jsx')),
  deal: lazy(() => import('../pipeline/DealSheet.jsx')),
  newDeal: lazy(() => import('../pipeline/NewDealSheet.jsx')),
  commissions: lazy(() => import('../../pages/pipeline/CommissionsPage.jsx')),
  book: lazy(() => import('../../pages/pipeline/BookPage.jsx')),
  payPlan: lazy(() => import('../pipeline/PayPlanSheet.jsx')),
  // listings
  listings: lazy(() => import('../../pages/listings/ListingsPage.jsx')),
  listing: lazy(() => import('../listings/ListingDetail.jsx')),
  newListing: lazy(() => import('../listings/AddListingSheet.jsx')),
  // calendar
  calendar: lazy(() => import('../../pages/dashboard/CalendarPage.jsx')),
  appointment: lazy(() => import('../calendar/AppointmentSheet.jsx')),
  newAppointment: lazy(() => import('../calendar/AddAppointmentSheet.jsx')),
  workSchedule: lazy(() => import('../dashboard/WorkScheduleSheet.jsx')),
  // campaigns
  campaigns: lazy(() => import('../../pages/campaigns/CampaignsPage.jsx')),
  campaign: lazy(() => import('../campaigns/CampaignDetail.jsx')),
  newCampaign: lazy(() => import('../campaigns/CampaignBuilder.jsx')),
  // AI + system
  serena: lazy(() => import('../serena/SerenaSheet.jsx')),
  call: lazy(() => import('../calls/ActiveCall.jsx')),
  notifications: lazy(() => import('../system/NotificationsPanel.jsx')),
  search: lazy(() => import('../system/GlobalSearch.jsx')),
  settings: lazy(() => import('../../pages/settings/SettingsPage.jsx')),
};

const SerenaBubble = lazy(() => import('../serena/SerenaBubble.jsx'));
const CallPill = lazy(() => import('../calls/CallPill.jsx'));

function Connecting() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 14 }}>
      Connecting…
    </div>
  );
}

function useBadges(authed) {
  const [badges, setBadges] = useState({});
  const timer = useRef(null);
  const refresh = useCallback(() => {
    if (!authed) return;
    api.get('/badges').then((b) => setBadges(b || {})).catch(() => {});
  }, [authed]);
  const debounced = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 400);
  }, [refresh]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('km:badges', debounced);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('km:badges', debounced); };
  }, [refresh, debounced]);
  useSocket(['message_received', 'conversation_read', 'message_sent', 'call_updated', 'deal_updated', 'notification'], debounced);
  useResync(refresh);
  return badges;
}

export default function AppShell() {
  const { status, user } = useAuth();
  const { tab, overlays } = useNav();
  useKeyboardInset();
  useTheme(user?.preferences);
  const badges = useBadges(status === 'authed');
  const onboarding = useOnboarding(status === 'authed');

  if (status === 'loading') return <Connecting />;
  if (status !== 'authed') return <Login />;
  if (onboarding.state?.assistant?.required) return <AssistantBuilder onDone={onboarding.refresh} />;

  const TabPage = TAB_PAGES[tab] || TAB_PAGES.home;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <main className="km-shell-main" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <ErrorBoundary key={tab}>
          <Suspense fallback={null}>
            <div className="km-tab-slot" key={tab}>
              <TabPage />
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>

      {overlays.map((o, i) => {
        const C = OVERLAYS[o.type];
        if (!C) return null;
        return (
          <OverlayDepth.Provider key={o.id} value={i + 1}>
            <ErrorBoundary fallback={null} onError={() => nav.close(o.id)}>
              <Suspense fallback={null}>
                <C {...o.props} overlayId={o.id} onClose={() => nav.close(o.id)} />
              </Suspense>
            </ErrorBoundary>
          </OverlayDepth.Provider>
        );
      })}

      <TabBar
        active={tab}
        onChange={(t) => (t === tab && overlays.length ? nav.closeAll() : nav.go(t))}
        badges={{ inbox: badges.unreadMessages, phone: badges.missedCalls }}
      />
      <SideMenu badges={badges} />

      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <SerenaBubble />
          <CallPill />
        </Suspense>
      </ErrorBoundary>

      <OnboardingChecklist state={onboarding.state} act={onboarding.act} showBanner={tab === 'home' && !overlays.length && !!onboarding.state?.dismissedAt} />
      <Toaster />
      <ConfirmHost />
    </div>
  );
}
