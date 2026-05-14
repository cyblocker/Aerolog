import React from 'react';
import { Column, Pie, Line } from '@ant-design/plots';

import type { Flight } from '../types';

interface Props {
  flights: Flight[];
}

const AnalyticsDashboard: React.FC<Props> = ({ flights }) => {
  // 1. Flights per Year
  const yearData = Object.entries(
    flights.reduce((acc, f) => {
      const year = f.flightDate.split('-')[0];
      acc[year] = (acc[year] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([year, count]) => ({ year, count })).sort((a, b) => a.year.localeCompare(b.year));

  // 2. Top Airlines
  const airlineData = Object.entries(
    flights.reduce((acc, f) => {
      acc[f.airlineIata] = (acc[f.airlineIata] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  )
    .map(([airline, count]) => ({ airline, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 3. Distance Trend (Cumulative)
  let cumulativeDistance = 0;
  const distanceTrend = flights
    .slice()
    .sort((a, b) => a.flightDate.localeCompare(b.flightDate))
    .map(f => {
      cumulativeDistance += (f.distanceKm || 0);
      return { date: f.flightDate, distance: cumulativeDistance };
    });

  // 4. Cabin Class Distribution
  const cabinData = Object.entries(
    flights.reduce((acc, f) => {
      if (f.cabinClass) {
        acc[f.cabinClass] = (acc[f.cabinClass] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>)
  ).map(([type, value]) => ({ type, value }));

  // 5. Travel Seasonality (Monthly Trends)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthCounts = flights.reduce((acc, f) => {
    const month = new Date(f.flightDate).getMonth();
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const seasonalityData = monthNames.map((name, index) => ({
    month: name,
    count: monthCounts[index] || 0
  }));

  const chartTheme = 'dark';

  return (
    <div className="tab-content animate-fade-in" style={{ gap: '1.5rem', display: 'flex', flexDirection: 'column' }}>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="card">
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Flights per Year</h3>
          <Column 
            data={yearData}
            xField="year"
            yField="count"
            theme={chartTheme}
            colorField="#6366f1"
            axis={{ x: { label: { autoRotate: false } } }}
          />
        </div>
        <div className="card">
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Top 10 Airlines</h3>
          <Pie 
            data={airlineData}
            angleField="count"
            colorField="airline"
            radius={0.8}
            theme={chartTheme}
            label={{
              text: 'airline',
              position: 'outside',
            }}
            legend={false}
          />
        </div>
      </div>
      
      <div className="card">
        <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Cumulative Distance (km)</h3>
        <Line 
          data={distanceTrend}
          xField="date"
          yField="distance"
          theme={chartTheme}
          colorField="#06b6d4"
          point={{ size: 2 }}
          axis={{ x: { label: { autoHide: true } } }}
        />
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="card">
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Travel Seasonality</h3>
          <Column 
            data={seasonalityData}
            xField="month"
            yField="count"
            theme={chartTheme}
            colorField="#10b981"
          />
        </div>
        <div className="card">
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Cabin class Distribution</h3>
          <Pie 
            data={cabinData}
            angleField="value"
            colorField="type"
            radius={0.8}
            theme={chartTheme}
            label={{
              text: 'type',
              position: 'outside',
            }}
            legend={false}
          />
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
