// New Development lane (pre-construction) — RevMatch's Allocations lane
// re-geared. The board tracks the CLIENT; this lane tracks the UNIT/BUILDING
// (unit selection → pricing → priority list → reserved → building delivered).
// Groups by lane stage (empty stages hidden); "Building's delivered — move to
// main pipeline" returns the deal at Under Contract. Lane deals are never stale.
import DealCard from './DealCard';
import Icon from '../ui/Icon';
import { StageDot } from './bits';

export default function NewDevLane({
  deals, cfg, open, onToggle, laneRef, expandedId, setExpandedId,
  onUpdate, onSave, onAdvance, onStageChange, onRequestLost, onDelete, onReturn, flashId, landedId,
}) {
  const stages = cfg.newDev.stages;
  const groups = Object.fromEntries(stages.map((s) => [s.key, []]));
  for (const d of deals) (groups[d.stage] || groups[stages[0].key]).push(d);
  const delivered = groups.building_delivered ? groups.building_delivered.length : 0;
  return (
    <section ref={laneRef} className={`km-pl-lane ${open ? 'km-pl-lane--open' : ''}`} aria-label="New Development lane">
      <button type="button" className="km-pl-lane-head" onClick={onToggle} aria-expanded={open}>
        <Icon name="building" size={15} color="var(--dim)" />
        <span className="km-pl-lane-title">New Development</span>
        <span className="km-mono" style={{ fontSize: 10.5, fontWeight: 500, color: deals.length ? 'var(--blue)' : 'var(--faint)' }}>{deals.length}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 2, minWidth: 0, overflow: 'hidden' }}>
          {stages.filter((s) => groups[s.key].length).map((s) => (
            <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <StageDot color={s.color} size={6} />
              <span className="km-mono" style={{ fontSize: 9, fontWeight: 500, color: 'var(--faint)' }}>{groups[s.key].length}</span>
            </span>
          ))}
        </span>
        <span style={{ flex: 1 }} />
        {delivered > 0 && !open ? <span className="km-pl-greenpill">{delivered} delivered</span> : null}
        <Icon name="chevronDown" size={13} color="var(--faint)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease' }} />
      </button>
      {open ? (
        <div className="km-pl-lane-body">
          {deals.length === 0 ? (
            <div className="km-pl-col-empty" style={{ padding: '22px 16px' }}>
              No pre-construction deals in flight. Pick “New Development” on a new deal to track a unit from selection to TCO.
            </div>
          ) : stages.map((s) => {
            const list = groups[s.key];
            if (!list.length) return null;
            return (
              <div key={s.key} className="km-pl-lane-group">
                <div className="km-pl-lane-grouphead">
                  <StageDot color={s.color} glow />
                  <span style={{ fontSize: 12.5, fontWeight: 500, letterSpacing: -0.2 }}>{s.label}</span>
                  <span className="km-mono" style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)' }}>{list.length}</span>
                  <span className="km-pl-col-sub">{s.sub}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {list.map((d) => (
                    <div key={d.id}>
                      <DealCard
                        deal={d}
                        cfg={cfg}
                        expanded={expandedId === d.id}
                        onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
                        onUpdate={(p) => onUpdate(d.id, p)}
                        onSave={() => onSave(d.id)}
                        onAdvance={onAdvance}
                        onStageChange={onStageChange}
                        onRequestLost={onRequestLost}
                        onDelete={onDelete}
                        flash={flashId === d.id}
                        landed={landedId === d.id}
                      />
                      {d.stage === 'building_delivered' ? (
                        <div className="km-pl-return">
                          <div className="km-pl-return-eyebrow">Building’s delivered — move to main pipeline</div>
                          <button type="button" className="km-pl-return-btn km-press" onClick={() => onReturn(d)}>→ Move to Under Contract</button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
