/**
 * Display casing for transcript words that Granite emits lowercase. ASCII only, so
 * lowercasing preserves length. Words that are also common lowercase words are
 * omitted (may, march, august, will, bill, mark, rose, china, turkey, polish,
 * chile, guinea, jersey, phoenix, lima, manila, danish, us).
 */
// prettier-ignore
export const TRANSCRIPT_PROPER_CASING: readonly string[] = [
  // Pronoun
  'I',
  // Days, months, holidays
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'April', 'June', 'July', 'September', 'October', 'November', 'December',
  'Christmas', 'Easter', 'Halloween', 'Thanksgiving', 'Hanukkah', 'Ramadan',
  // Continents and regions
  'Africa', 'Antarctica', 'Asia', 'Australia', 'Europe', 'America', 'Britain',
  'North America', 'South America', 'Latin America', 'Middle East', 'Southeast Asia',
  // Countries
  'Afghanistan', 'Argentina', 'Austria', 'Bangladesh', 'Belgium', 'Brazil', 'Canada', 'Colombia', 'Cuba',
  'Denmark', 'Egypt', 'England', 'Ethiopia', 'Finland', 'France', 'Germany', 'Ghana', 'Greece', 'Haiti',
  'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica',
  'Japan', 'Jordan', 'Kenya', 'Korea', 'Lebanon', 'Malaysia', 'Mexico', 'Morocco', 'Nepal', 'Netherlands',
  'Nigeria', 'Norway', 'Pakistan', 'Palestine', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Romania',
  'Russia', 'Scotland', 'Singapore', 'Somalia', 'Spain', 'Sudan', 'Sweden', 'Switzerland', 'Syria',
  'Taiwan', 'Thailand', 'Ukraine', 'Venezuela', 'Vietnam', 'Wales', 'Yemen',
  'United States', 'United Kingdom', 'Great Britain', 'New Zealand', 'South Africa', 'North Korea',
  'South Korea', 'Saudi Arabia', 'Sri Lanka', 'Costa Rica', 'Puerto Rico', 'Hong Kong', 'Soviet Union',
  'Czech Republic', 'Dominican Republic',
  // US states
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida',
  'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska',
  'Nevada', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'Wisconsin', 'Wyoming',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Rhode Island',
  'South Carolina', 'South Dakota', 'West Virginia',
  // Cities
  'Amsterdam', 'Athens', 'Atlanta', 'Austin', 'Baltimore', 'Bangkok', 'Barcelona', 'Beijing', 'Berlin',
  'Boston', 'Brooklyn', 'Brussels', 'Cairo', 'Chicago', 'Cleveland', 'Dallas', 'Delhi', 'Denver', 'Detroit',
  'Dubai', 'Dublin', 'Edinburgh', 'Geneva', 'Havana', 'Hollywood', 'Houston', 'Istanbul', 'Jerusalem',
  'Kyoto', 'Lagos', 'Lisbon', 'London', 'Madrid', 'Manchester', 'Manhattan', 'Melbourne', 'Memphis',
  'Miami', 'Milan', 'Milwaukee', 'Minneapolis', 'Montreal', 'Moscow', 'Mumbai', 'Munich', 'Nashville',
  'Orlando', 'Osaka', 'Oslo', 'Ottawa', 'Paris', 'Philadelphia', 'Pittsburgh', 'Portland', 'Prague', 'Rome',
  'Sacramento', 'Seattle', 'Seoul', 'Shanghai', 'Stockholm', 'Sydney', 'Tokyo', 'Toronto', 'Vancouver',
  'Venice', 'Vienna', 'Warsaw', 'Zurich',
  'Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'San Antonio', 'Las Vegas', 'New Orleans',
  'New Delhi', 'Mexico City', 'New York City', 'Salt Lake City', 'Kansas City', 'Oklahoma City',
  'Silicon Valley', 'Buenos Aires', 'Rio de Janeiro', 'Tel Aviv', 'Abu Dhabi', 'Cape Town',
  // Nationalities, languages, religions
  'American', 'African', 'Arabic', 'Asian', 'Australian', 'Brazilian', 'British', 'Buddhist', 'Canadian',
  'Catholic', 'Chinese', 'Christian', 'Dutch', 'Egyptian', 'English', 'European', 'French', 'German', 'Greek',
  'Hebrew', 'Hindu', 'Indian', 'Irish', 'Islam', 'Islamic', 'Israeli', 'Italian', 'Japanese', 'Jewish',
  'Korean', 'Latin', 'Latino', 'Mexican', 'Muslim', 'Pakistani', 'Persian', 'Portuguese', 'Protestant',
  'Russian', 'Scottish', 'Spanish', 'Swedish', 'Swiss', 'Turkish', 'Ukrainian', 'Vietnamese',
  // Acronyms
  'TV', 'USA', 'UK', 'EU', 'AI', 'FBI', 'CIA', 'NASA', 'CEO', 'DNA', 'BBC', 'CNN', 'NFL', 'NBA', 'GPS', 'ATM',
  'DVD', 'PhD',
]
