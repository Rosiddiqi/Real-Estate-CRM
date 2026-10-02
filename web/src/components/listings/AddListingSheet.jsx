// STUB — replaced by the feature builder. Sheet overlay "New Listing".
// Overlay contract: receives { ...props, overlayId, onClose }.
import Sheet from '../ui/Sheet';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="New Listing">
      <EmptyState icon="sparkle" title="New Listing" sub="This surface is being built." />
    </Sheet>
  );
}
