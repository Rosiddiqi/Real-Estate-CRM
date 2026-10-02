// STUB — replaced by the feature builder. Sheet overlay "Work Schedule".
// Overlay contract: receives { ...props, overlayId, onClose }.
import Sheet from '../ui/Sheet';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="Work Schedule">
      <EmptyState icon="sparkle" title="Work Schedule" sub="This surface is being built." />
    </Sheet>
  );
}
