// STUB — replaced by the feature builder. Push-panel overlay "Client".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../ui/PushPanel';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Client">
      <EmptyState icon="sparkle" title="Client" sub="This surface is being built." />
    </PushPanel>
  );
}
