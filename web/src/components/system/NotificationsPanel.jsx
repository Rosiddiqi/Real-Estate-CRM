// STUB — replaced by the feature builder. Push-panel overlay "Notifications".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../ui/PushPanel';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Notifications">
      <EmptyState icon="sparkle" title="Notifications" sub="This surface is being built." />
    </PushPanel>
  );
}
