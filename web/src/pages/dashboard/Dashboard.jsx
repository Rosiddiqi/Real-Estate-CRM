// STUB — replaced by the feature builder. Tab root for "Home".
import PageHeader from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/kit';

export default function Page() {
  return (
    <div className="km-screen">
      <PageHeader title="Home" large />
      <div className="km-screen-body km-scroll">
        <EmptyState icon="home" title="Home" sub="This surface is being built." />
      </div>
    </div>
  );
}
