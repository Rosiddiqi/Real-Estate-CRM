// STUB — replaced by the feature builder. Push-panel overlay "Calendar".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../../components/ui/PushPanel';
import { EmptyState } from '../../components/ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Calendar">
      <EmptyState icon="sparkle" title="Calendar" sub="This surface is being built." />
    </PushPanel>
  );
}
