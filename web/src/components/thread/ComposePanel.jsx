// STUB — replaced by the feature builder. Push-panel overlay "New Message".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../ui/PushPanel';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="New Message">
      <EmptyState icon="sparkle" title="New Message" sub="This surface is being built." />
    </PushPanel>
  );
}
