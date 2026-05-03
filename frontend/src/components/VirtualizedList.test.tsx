import { render, screen } from '@testing-library/react';
import VirtualizedList from './VirtualizedList';

describe('VirtualizedList', () => {
  it('windows rows and announces visible range', () => {
    const items = Array.from({ length: 200 }, (_, i) => `Row ${i + 1}`);
    render(
      <VirtualizedList
        items={items}
        itemHeight={20}
        height={100}
        ariaLabel="Rows"
        renderItem={(item) => <div key={item}>{item}</div>}
      />,
    );
    expect(screen.getByText(/Showing rows 1 to/i)).toBeTruthy();
    expect(screen.getByText('Row 1')).toBeTruthy();
    expect(screen.queryByText('Row 180')).not.toBeTruthy();
  });
});
