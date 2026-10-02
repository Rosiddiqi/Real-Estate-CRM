// STUB — replaced by the feature builder. Push-panel overlay "Campaign".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../ui/PushPanel';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Campaign">
      <EmptyState icon="sparkle" title="Campaign" sub="This surface is being built." />
    </PushPanel>
  );
}
