// STUB — replaced by the feature builder. Sheet overlay "New Appointment".
// Overlay contract: receives { ...props, overlayId, onClose }.
import Sheet from '../ui/Sheet';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="New Appointment">
      <EmptyState icon="sparkle" title="New Appointment" sub="This surface is being built." />
    </Sheet>
  );
}
