// Deal sheet — open any deal by id from anywhere (client card, Serena cards,
// notifications, search): nav.openDeal(id). Same expanded-card UI as the board
// (DealDetail), live via the shared deal store, with "Open in pipeline".
import { useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import PropertyPhoto from '../ui/PropertyPhoto';
import { EmptyState, Skeleton } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import DealDetail from './DealDetail';
import LostReasonSheet from './LostReasonSheet';
import { StageDot, shortDate } from './bits';
import { usePipelineConfig } from './config';
import { flushDeal, moveDeal, removeDeal, reopenDeal, updateDeal, useDeal, useDealRealtime, useDealStore } from './dealStore';
import { moveWithFlow } from './actions';
import '../../styles/pipeline.css';

export default function DealSheet({ id, onClose }) {
  useDealRealtime();
  const { cfg } = usePipelineConfig();
  const deal = useDeal(id);
  const store = useDealStore();
  const [lostOpen, setLostOpen] = useState(false);
  const missing = !deal && store.loadedAt && store.error;

  return (
    <Sheet
      open
      onClose={onClose}
      title={deal ? deal.name : 'Deal'}
      subtitle={deal ? `${deal.sideLabel} · ${deal.label}` : undefined}
      left={{ label: 'Done' }}
      maxHeight="90%"
      zIndex={440}
      footer={({ close }) => (
        <button
          type="button"
          className="km-btn km-btn--ghost km-btn--block km-press"
          onClick={() => { close(); setTimeout(() => nav.openPipeline(id), 260); }}
        >
          <Icon name="pipeline" size={16} /> Open in pipeline
        </button>
      )}
    >
      {({ close }) => (
        !deal || !cfg ? (
          missing ? <EmptyState icon="pipeline" title="Deal not found" sub="It may have been deleted." /> : (
            <div style={{ padding: '6px 2px' }}>
              <Skeleton h={130} r={16} />
              <Skeleton h={16} w="60%" style={{ marginTop: 14 }} />
              <Skeleton h={12} w="40%" style={{ marginTop: 8 }} />
              <Skeleton h={180} r={14} style={{ marginTop: 16 }} />
            </div>
          )
        ) : (
          <div>
            <PropertyPhoto src={deal.photo} seed={deal.listingId || deal.address || deal.id} height={132} radius={16} label={deal.listing ? deal.listing.neighborhood : null}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 35%, rgba(0,0,0,0.62))' }} />
              <div style={{ position: 'absolute', left: 14, right: 14, bottom: 12, display: 'flex', alignItems: 'flex-end', gap: 10, color: '#fff' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="km-truncate" style={{ fontSize: 16, fontWeight: 500 }}>{deal.address || deal.propertyLabel || 'Property to be set'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                    <StageDot color={deal.color} glow />
                    {deal.label}
                    {deal.closing ? ` · closing ${shortDate(deal.closing.date)}` : deal.closedAt ? ` · ${shortDate(deal.closedAt, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                  </div>
                </div>
                {deal.price ? (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.4 }}>{moneyCompact(deal.price)}</div>
                    <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: 1, opacity: 0.75 }}>{deal.priceCaption}</div>
                  </div>
                ) : null}
              </div>
            </PropertyPhoto>
            <div style={{ margin: '0 -2px' }} className="km-pl-card km-pl-card--expanded" data-deal-id={deal.id}>
              <DealDetail
                deal={deal}
                cfg={cfg}
                onUpdate={(p) => updateDeal(deal.id, p)}
                onSave={() => flushDeal(deal.id)}
                onStageChange={(s) => moveWithFlow(deal, s)}
                onRequestLost={() => setLostOpen(true)}
                onReopen={() => reopenDeal(deal.id).then(() => toast.success('Back on the board')).catch(() => {})}
                onDelete={async () => { close(); if (await removeDeal(deal.id)) toast(`Deleted ${deal.name}’s deal`); }}
              />
            </div>
            <LostReasonSheet
              deal={deal}
              open={lostOpen}
              onClose={() => setLostOpen(false)}
              onConfirm={async (reason) => {
                try {
                  await moveDeal(deal.id, 'lost', { lostReason: reason });
                  setLostOpen(false);
                  toast(`${deal.name} moved to Lost`, { action: { label: 'Undo', onClick: () => reopenDeal(deal.id).catch(() => {}) } });
                } catch { /* toasted */ }
              }}
            />
          </div>
        )
      )}
    </Sheet>
  );
}
