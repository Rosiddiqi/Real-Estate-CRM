// STUB — replaced by the feature builder. Push-panel overlay "Import".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../../components/ui/PushPanel';
import { EmptyState } from '../../components/ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Import">
      <EmptyState icon="sparkle" title="Import" sub="This surface is being built." />
    </PushPanel>
  );
}
