// STUB — replaced by the feature builder. Push-panel overlay "Listing".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../ui/PushPanel';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Listing">
      <EmptyState icon="sparkle" title="Listing" sub="This surface is being built." />
    </PushPanel>
  );
}
