// STUB — replaced by the feature builder. Push-panel overlay "Call".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../ui/PushPanel';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Call">
      <EmptyState icon="sparkle" title="Call" sub="This surface is being built." />
    </PushPanel>
  );
}
